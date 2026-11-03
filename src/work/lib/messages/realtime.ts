import { loadMessagesByIds } from './actions'
import { isStaleActionError } from './stale-deploy'
import type { ChatMessage, ReactionRow } from './types'
import type { SidebarBadgeSnapshot } from '@work/lib/channels/badge-snapshot'
import {
  POLL_BACKOFF_MS,
  POLL_FOCUSED_MS,
  POLL_IDLE_MS,
  messageOp,
  nextPollDelay,
} from '@work/lib/sync/poll'
import {
  SYNC_MAX_CHANNELS,
  type SyncChannelChange,
  type SyncRequest,
  type SyncResponse,
} from '@work/lib/sync/contract'

/**
 * 채널 토픽 구독 허브(브라우저 전용) — ggac 이식: **Supabase Realtime 대신 폴링**(docs/board-work/02-sync.md §5).
 *
 * 내보내는 API(`subscribeChannelTopic`·`subscribeUserTopic`·`subscribeWorkspacePresence`·`TopicEvent`·`TopicStatus`·
 * `TopicHandle`)는 원본(kosmart-work `lib/messages/realtime.ts`)과 같다 — ChannelView·ThreadPanel·use-channel-topic·
 * use-workspace-presence는 고치지 않는다. 내부만 바뀌었다:
 *
 * - **폴러는 탭(브라우저 창)당 하나.** 구독 중인 채널 토픽의 rev를 모아 `POST /api/board-room/work/sync` 한 번에 싣는다.
 * - 주기(설계 §6-3): 채널·스레드 토픽이 하나라도 있으면 3초, 없으면(사이드바 배지·접속 표시만) 10초. 탭이 숨으면
 *   멈추고 다시 보이면 즉시 1회. 연속 실패는 3→6→12→30초 백오프(`status: 'error'` → ChatStatus "연결이 끊겼습니다").
 *   메시지를 보낸 직후에는 `requestSync()`로 즉시 1회.
 * - 응답 → TopicEvent: `changed[c].messageIds`는 **값을 믿지 않고** 원본과 똑같이 `loadMessagesByIds`(읽기 범위 재적용)로
 *   다시 읽어 그 채널 토픽에 `message` 이벤트로 알린다. 다른 채널 행은 버린다. 결과에 없는 id는 DELETE.
 *   반응도 메시지 rev가 올라 이 경로로 온다(다시 읽은 행에 반응이 들어 있다 — 별도 `reaction` 이벤트는 없다).
 *   `pinsChanged` → `pins`, `tabsChanged` → `tabs`, `resync`(200건 초과) → 재연결 경로(`status` error → connected:
 *   ChannelView는 refetchLatest, ThreadPanel은 loadThread), `membershipChanged` → 사용자 토픽 `MEMBER_ADDED`,
 *   `typing` → 지금 보는 채널 토픽, `online` → presence.
 * - 재조회가 실패하면 그 채널의 rev를 올리지 않는다 — 다음 폴이 같은 id를 다시 받아 자연히 재시도한다.
 *   VERIFY_RETRY_MAX번 넘게 실패하면 `sync-lost`('failed'), 배포로 낡은 탭이면 바로 `sync-lost`('stale-deploy').
 *   다시 성공하면 `sync-ok`.
 *
 * 사이드바 배지는 채널마다 구독하지 않고 응답의 `badges`를 그대로 받는다(`subscribeBadges` — 이식에서 더한 API).
 */

export type TopicStatus = 'connecting' | 'connected' | 'error' | 'closed'

/** 지워진 메시지 식별(재조회로 없음을 확인한 뒤에만 보낸다) */
export type MessageRef = Pick<ChatMessage, 'id' | 'channel_id' | 'parent_id'>
export type ReactionRef = Pick<ReactionRow, 'message_id' | 'user_id' | 'emoji'>

export type TopicEvent =
  | {
      type: 'message'
      op: 'INSERT' | 'UPDATE' | 'DELETE'
      /** 서버에서 다시 읽은 행(반응·첨부 포함). DELETE 면 null */
      record: ChatMessage | null
      old: MessageRef | null
    }
  /** 원본 Realtime 반응 신호. 폴링에서는 반응이 메시지 UPDATE로 오므로 보내지 않는다(타입은 원본 그대로 둔다). */
  | {
      type: 'reaction'
      op: 'INSERT' | 'DELETE'
      record: ReactionRef | null
      old: ReactionRef | null
    }
  /** 고정 목록이 바뀌었다는 신호. 받는 쪽이 서버에서 다시 읽는다. */
  | { type: 'pins' }
  /** 대화 탭이 바뀌었다는 신호(2단계). 받는 쪽은 서버 렌더를 다시 부르기만 한다. */
  | { type: 'tabs' }
  /** scope: 스레드 입력창이면 부모 메시지 id, 채널 입력창이면 null */
  | { type: 'typing'; userId: string; displayName: string; scope: string | null }
  | { type: 'presence'; userIds: string[] }
  /**
   * 사용자 토픽 신호 — 내 사이드바 목록이 바뀌었다(채널 추가·DM 열림 등, `membershipChanged`).
   * 폴링은 어느 채널인지 알려 주지 않으므로 channelId는 늘 null이다(받는 쪽은 서버 렌더를 다시 부른다).
   */
  | { type: 'user'; event: 'MEMBER_ADDED' | 'DM_MESSAGE'; channelId: string | null }
  | { type: 'status'; status: TopicStatus }
  /**
   * 신호의 재조회가 끝내 실패했다 — 화면이 최신이 아닐 수 있다.
   * reason 'stale-deploy' = 배포로 서버 액션 id 가 바뀐 낡은 탭(새로고침만 해결).
   */
  | { type: 'sync-lost'; reason: 'failed' | 'stale-deploy' }
  /** sync-lost 뒤 재조회가 다시 성공했다 */
  | { type: 'sync-ok' }

export type TopicListener = (event: TopicEvent) => void

export type PresenceMeta = { user_id: string; display_name: string }

/**
 * 응답의 배지 스냅샷 수신자. requestedAt = 그 요청을 보낸 시각(ms) — 사이드바가 읽음 기록과 비교한다.
 * membershipChanged = 내 대화 목록이 바뀌었다(새 DM·채널 초대 — 사용자 토픽 `MEMBER_ADDED`와 같은 신호). 이사회실 메뉴가
 * 대화 종류(채널/DM)를 다시 읽는 데 쓴다(ggac에서 더한 인자)
 */
export type BadgeListener = (
  snapshot: SidebarBadgeSnapshot,
  requestedAt: number,
  membershipChanged: boolean
) => void

// ── 주기(설계 §6-3) — 순수 규칙은 lib/sync/poll.ts ─────────────────────────────

export { POLL_BACKOFF_MS, POLL_FOCUSED_MS, POLL_IDLE_MS, messageOp, nextPollDelay }

/** 입력 중 신호를 싣는 최소 간격(계약 §2: 최대 3초에 한 번) */
export const TYPING_SEND_MIN_MS = 3_000
/** 재조회 실패를 이만큼 넘게 이어서 겪으면 sync-lost('failed') */
export const VERIFY_RETRY_MAX = 4
/** 마지막 구독자가 떠난 뒤 토픽을 닫기까지(화면 전환·StrictMode 재마운트에서 바로 다시 쓰면 재사용) */
const CLOSE_GRACE_MS = 1000
/** 서버 액션 한 번에 읽는 id 수(loadMessagesByIds 상한) */
const VERIFY_CHUNK = 100
const SYNC_URL = '/api/board-room/work/sync'

// ── 토픽 ────────────────────────────────────────────────────────────────────────

type Tracker = PresenceMeta & { scope: string | null }

type Entry = {
  /** 원본 토픽 이름('channel:<id>' · 'user:<id>' · 'presence:workspace') */
  topic: string
  kind: 'channel' | 'user' | 'workspace'
  /** kind='channel' 이면 채널 id, 'user' 면 사용자 id, 'workspace' 면 'workspace' */
  channelId: string
  listeners: Set<TopicListener>
  trackers: Map<symbol, Tracker>
  status: TopicStatus
  online: string[]
  closed: boolean
  closeTimer: ReturnType<typeof setTimeout> | null
  /** (채널) 마지막으로 반영한 rev. null = 아직 모른다 → 0을 보내고 첫 응답의 rev를 그대로 받는다(이벤트 없이) */
  rev: number | null
  /** (채널) 지난 응답의 서버 시각(ms) — 새 글/수정 구분(messageOp) */
  since: number | null
  /** (채널) 재조회 연속 실패 수 */
  verifyFailures: number
  syncLost: boolean
  /** 구독 순번 — 가장 최근에 연 채널 화면이 focus(입력 중 표시 대상)다 */
  seq: number
}

const entries = new Map<string, Entry>()
const badgeListeners = new Set<BadgeListener>()
let subscribeSeq = 0

function emit(entry: Entry, event: TopicEvent) {
  for (const l of [...entry.listeners]) {
    try {
      l(event)
    } catch (e) {
      console.error('[realtime] listener 오류:', e)
    }
  }
}

function setStatus(entry: Entry, status: TopicStatus) {
  if (entry.status === status) return
  entry.status = status
  emit(entry, { type: 'status', status })
}

// ── 폴러(탭당 하나) ─────────────────────────────────────────────────────────────

const poller = {
  timer: null as ReturnType<typeof setTimeout> | null,
  inFlight: false,
  /** 진행 중에 즉시 폴 요청이 들어왔다 → 끝나자마자 한 번 더 */
  again: false,
  failures: 0,
  membershipRev: null as number | null,
  typing: null as { channelId: string; scope: string | null } | null,
  lastTypingAt: 0,
  visibilityBound: false,
}

function activeEntries(): Entry[] {
  return [...entries.values()].filter(e => !e.closed && e.listeners.size > 0)
}

function hasSubscribers(): boolean {
  return badgeListeners.size > 0 || activeEntries().length > 0
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function bindVisibility() {
  if (poller.visibilityBound || typeof document === 'undefined') return
  poller.visibilityBound = true
  document.addEventListener('visibilitychange', () => {
    if (isHidden()) {
      if (poller.timer) clearTimeout(poller.timer)
      poller.timer = null
    } else {
      // 다시 보이면 즉시 1회(원본의 "30초 숨김 뒤 재동기화" 자리)
      requestSync()
    }
  })
}

function schedule(delay: number) {
  if (poller.timer) clearTimeout(poller.timer)
  poller.timer = null
  if (!hasSubscribers() || isHidden()) return
  poller.timer = setTimeout(() => {
    poller.timer = null
    void poll()
  }, delay)
}

function scheduleNext() {
  const focused = activeEntries().some(e => e.kind === 'channel')
  schedule(nextPollDelay({ focused, failures: poller.failures }))
}

/**
 * 지금 바로 한 번 동기화한다(이식에서 더한 API) — 메시지를 보낸 직후(`sentIn` = 그 채널)·탭이 다시 보일 때.
 * 진행 중이면 끝난 뒤 한 번 더 돈다.
 */
export function requestSync(opts: { sentIn?: string } = {}) {
  if (typeof window === 'undefined') return
  // 그 채널에 방금 보냈다 — 아직 싣지 않은 "입력 중" 신호는 버린다(서버도 보낸 사람의 행을 지운다)
  if (opts.sentIn && poller.typing?.channelId === opts.sentIn) poller.typing = null
  if (opts.sentIn) poller.lastTypingAt = 0
  if (poller.inFlight) {
    poller.again = true
    return
  }
  if (isHidden()) return
  schedule(0)
}

/** 지금 보는 채널(입력 중 표시 대상) — 추적(track) 중인 채널 토픽 중 가장 최근에 연 것 */
function focusEntry(list: Entry[]): Entry | null {
  let best: Entry | null = null
  for (const e of list) {
    if (e.kind !== 'channel' || e.trackers.size === 0) continue
    if (!best || e.seq > best.seq) best = e
  }
  return best
}

function buildRequest(list: Entry[]): { body: SyncRequest; sent: Map<string, number | null> } {
  const sent = new Map<string, number | null>()
  const channels: Record<string, number> = {}
  // 최근에 연 화면부터 싣는다(상한 50 — 넘는 일은 없지만 넘으면 오래된 쪽을 뺀다)
  for (const e of [...list].sort((a, b) => b.seq - a.seq)) {
    if (e.kind !== 'channel' || sent.size >= SYNC_MAX_CHANNELS) continue
    sent.set(e.channelId, e.rev)
    channels[e.channelId] = e.rev ?? 0
  }
  const focus = focusEntry(list)
  let threadId: string | null = null
  if (focus) {
    for (const t of focus.trackers.values()) if (t.scope) threadId = t.scope
  }
  const typing = poller.typing
  poller.typing = null
  return {
    body: {
      channels,
      membershipRev: poller.membershipRev,
      focus: focus ? { channelId: focus.channelId, threadId } : null,
      typing,
    },
    sent,
  }
}

async function postSync(body: SyncRequest): Promise<SyncResponse> {
  const res = await fetch(SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`sync ${res.status}`)
  const json = (await res.json()) as { success?: boolean; data?: SyncResponse }
  if (!json?.success || !json.data) throw new Error('sync: 잘못된 응답')
  return json.data
}

async function poll() {
  if (poller.inFlight) {
    poller.again = true
    return
  }
  const list = activeEntries()
  if (list.length === 0 && badgeListeners.size === 0) return
  poller.inFlight = true
  poller.again = false
  const requestedAt = Date.now()
  const { body, sent } = buildRequest(list)
  try {
    const data = await postSync(body)
    poller.failures = 0
    await applyResponse(data, sent, requestedAt)
  } catch (e) {
    poller.failures += 1
    if (poller.failures === 1) console.warn('[realtime] 동기화 실패:', e)
    for (const entry of activeEntries()) setStatus(entry, 'error')
  } finally {
    poller.inFlight = false
    if (poller.again) {
      poller.again = false
      schedule(0)
    } else {
      scheduleNext()
    }
  }
}

async function applyResponse(
  data: SyncResponse,
  sent: Map<string, number | null>,
  requestedAt: number
) {
  const serverTime = Date.parse(data.serverTime)
  const now = Number.isNaN(serverTime) ? Date.now() : serverTime

  // 사이드바 목록(채널 추가·DM 열림 등)
  const membershipChanged = poller.membershipRev !== null && data.membershipChanged
  poller.membershipRev = data.membershipRev

  for (const l of [...badgeListeners]) {
    try {
      l(data.badges, requestedAt, membershipChanged)
    } catch (e) {
      console.error('[realtime] 배지 listener 오류:', e)
    }
  }

  const list = activeEntries()
  const focus = focusEntry(list)
  for (const entry of list) {
    if (entry.kind === 'user') {
      setStatus(entry, 'connected')
      if (membershipChanged) {
        emit(entry, { type: 'user', event: 'MEMBER_ADDED', channelId: null })
      }
    } else if (entry.kind === 'workspace') {
      entry.online = data.online
      setStatus(entry, 'connected')
      emit(entry, { type: 'presence', userIds: data.online })
    }
  }

  // 채널 토픽 — 이번 요청에 실었던 것만(그 사이 새로 연 토픽은 다음 폴이 맡는다)
  await Promise.all(
    list
      .filter(e => e.kind === 'channel' && sent.has(e.channelId))
      .map(entry =>
        applyChannel(entry, data.changed[entry.channelId], sent.get(entry.channelId), now)
      )
  )

  for (const entry of list) {
    if (entry.kind !== 'channel' || entry.closed) continue
    entry.online = data.online
    emit(entry, { type: 'presence', userIds: data.online })
  }

  if (focus && !focus.closed) {
    for (const t of data.typing) {
      emit(focus, { type: 'typing', userId: t.userId, displayName: t.displayName, scope: t.scope })
    }
  }
}

async function applyChannel(
  entry: Entry,
  change: SyncChannelChange | undefined,
  sentRev: number | null | undefined,
  now: number
) {
  // 요청 뒤에 다른 경로(재연결 등)로 커서가 바뀌었으면 이번 결과는 버린다(다음 폴이 다시 가져온다)
  if (entry.rev !== sentRev) return
  if (!change) {
    if (entry.rev === null) entry.rev = 0 // 채널이 아직 비어 있다(rev 0)
    entry.since = now
    setStatus(entry, 'connected')
    return
  }
  if (entry.rev === null) {
    // 처음 붙었다 — 커서만 받는다. 화면은 첫 connected 에서 최신 페이지를 다시 읽는다(ChannelView refetchLatest)
    entry.rev = change.rev
    entry.since = now
    setStatus(entry, 'connected')
    return
  }
  if (change.resync) {
    // 200건 넘게 바뀌었다 — 원본 재연결 경로(끊김 → 연결)로 최신 페이지·스레드를 다시 읽게 한다
    entry.rev = change.rev
    entry.since = now
    setStatus(entry, 'error')
    setStatus(entry, 'connected')
    if (change.pinsChanged) emit(entry, { type: 'pins' })
    if (change.tabsChanged) emit(entry, { type: 'tabs' })
    return
  }
  if (change.messageIds.length > 0) {
    const verified = await verify(entry, change.messageIds)
    if (!verified) return // rev를 올리지 않는다 → 다음 폴이 같은 id를 다시 받는다
    if (entry.closed) return
    const since = entry.since
    for (const id of change.messageIds) {
      const row = verified.get(id)
      if (row) {
        emit(entry, { type: 'message', op: messageOp(row, since), record: row, old: null })
      } else {
        emit(entry, {
          type: 'message',
          op: 'DELETE',
          record: null,
          old: { id, channel_id: entry.channelId, parent_id: null },
        })
      }
    }
  }
  entry.rev = change.rev
  entry.since = now
  setStatus(entry, 'connected')
  if (change.pinsChanged) emit(entry, { type: 'pins' })
  if (change.tabsChanged) emit(entry, { type: 'tabs' })
}

/** 신호의 id를 읽기 범위 안에서 다시 읽는다. 실패하면 null(재시도는 다음 폴) */
async function verify(entry: Entry, ids: string[]): Promise<Map<string, ChatMessage> | null> {
  const byId = new Map<string, ChatMessage>()
  const list = [...new Set(ids)]
  for (let i = 0; i < list.length; i += VERIFY_CHUNK) {
    let res: Awaited<ReturnType<typeof loadMessagesByIds>>
    try {
      res = await loadMessagesByIds({ messageIds: list.slice(i, i + VERIFY_CHUNK) })
    } catch (e) {
      console.error('[realtime] 재조회 실패:', e)
      failVerify(entry, isStaleActionError(e))
      return null
    }
    if (!res.ok) {
      console.error('[realtime] 재조회 실패:', res.error)
      failVerify(entry, false)
      return null
    }
    // 다른 채널의 행은 버린다(응답을 위조해 남의 id를 넣어도 이 토픽에 섞이지 않게)
    for (const m of res.data) if (m.channel_id === entry.channelId) byId.set(m.id, m)
  }
  entry.verifyFailures = 0
  if (entry.syncLost && !entry.closed) {
    entry.syncLost = false
    emit(entry, { type: 'sync-ok' })
  }
  return byId
}

function failVerify(entry: Entry, stale: boolean) {
  if (entry.closed) return
  if (stale) {
    if (!entry.syncLost) {
      entry.syncLost = true
      emit(entry, { type: 'sync-lost', reason: 'stale-deploy' })
    }
    return
  }
  entry.verifyFailures += 1
  if (entry.verifyFailures > VERIFY_RETRY_MAX && !entry.syncLost) {
    entry.syncLost = true
    emit(entry, { type: 'sync-lost', reason: 'failed' })
  }
}

// ── 구독 API(원본과 같은 이름·모양) ──────────────────────────────────────────────

export type TopicHandle = {
  unsubscribe: () => void
  /** 입력 중 신호. scope 는 스레드 부모 id(채널 입력창이면 생략). 다음 폴에 실린다 */
  sendTyping: (scope?: string | null) => void
  getStatus: () => TopicStatus
  getOnline: () => string[]
}

/**
 * 채널 토픽 구독. `track` 을 주면 이 채널을 "보는 중"으로 본다(입력 중 표시 대상 — 채널 화면만 준다).
 * 이식에서 더한 선택 인자: `rev`(화면 로더 `loadChannelViewData`가 준 시작 커서), `scope`(스레드 패널이면 부모 id).
 */
export function subscribeChannelTopic(
  channelId: string,
  listener: TopicListener,
  opts: { track?: PresenceMeta; rev?: number | null; scope?: string | null } = {}
): TopicHandle {
  return subscribeEntry(`channel:${channelId}`, 'channel', channelId, listener, opts)
}

/**
 * 내 사용자 토픽 구독. 사이드바 목록이 바뀌면(membershipChanged) `{ type: 'user' }` 가 온다.
 */
export function subscribeUserTopic(userId: string, listener: TopicListener): TopicHandle {
  return subscribeEntry(`user:${userId}`, 'user', userId, listener, {})
}

/** 원본 워크스페이스 토픽 이름(식별용으로만 남긴다) */
export const WORKSPACE_PRESENCE_TOPIC = 'presence:workspace'

/**
 * 워크스페이스 접속 상태 구독. 접속자(60초 안에 동기화한 사람)는 `{ type: 'presence', userIds }` 로 온다.
 * 폴링 요청 자체가 접속 기록이라 `track` 은 받기만 하고 따로 보내지 않는다.
 */
export function subscribeWorkspacePresence(
  listener: TopicListener,
  opts: { track?: PresenceMeta } = {}
): TopicHandle {
  return subscribeEntry(WORKSPACE_PRESENCE_TOPIC, 'workspace', 'workspace', listener, opts)
}

/**
 * 사이드바 배지 구독(이식에서 더한 API) — 응답마다 `badges`(getSidebarBadges와 같은 모양)를 받는다.
 * 원본 SidebarLiveUpdates는 채널마다 토픽을 구독해 신호가 오면 getSidebarBadges를 불렀다. 폴링은 응답에 배지가 늘 실려
 * 그럴 필요가 없다(02-sync.md §5). 해제 함수를 돌려준다.
 */
export function subscribeBadges(listener: BadgeListener): () => void {
  badgeListeners.add(listener)
  bindVisibility()
  if (!poller.timer && !poller.inFlight) requestSync()
  return () => {
    badgeListeners.delete(listener)
  }
}

function subscribeEntry(
  topic: string,
  kind: Entry['kind'],
  channelId: string,
  listener: TopicListener,
  opts: { track?: PresenceMeta; rev?: number | null; scope?: string | null }
): TopicHandle {
  let entry = entries.get(topic)
  const isNew = !entry
  if (!entry) {
    entry = {
      topic,
      kind,
      channelId,
      listeners: new Set(),
      trackers: new Map(),
      status: 'connecting',
      online: [],
      closed: false,
      closeTimer: null,
      rev: null,
      since: null,
      verifyFailures: 0,
      syncLost: false,
      seq: 0,
    }
    entries.set(topic, entry)
  }
  const e = entry
  if (e.closeTimer) {
    clearTimeout(e.closeTimer)
    e.closeTimer = null
  }
  if (e.rev === null && typeof opts.rev === 'number' && opts.rev >= 0) e.rev = opts.rev
  e.seq = ++subscribeSeq
  e.listeners.add(listener)
  const token = Symbol('tracker')
  if (opts.track) e.trackers.set(token, { ...opts.track, scope: opts.scope ?? null })
  bindVisibility()
  // 새 토픽은 바로 한 번 동기화한다(첫 connected → 화면이 빈틈을 메운다). 기존 토픽 재사용은 주기를 그대로 둔다.
  if (isNew || !poller.timer) requestSync()

  let done = false
  return {
    unsubscribe() {
      if (done) return
      done = true
      e.listeners.delete(listener)
      e.trackers.delete(token)
      if (e.listeners.size === 0 && !e.closeTimer) {
        e.closeTimer = setTimeout(() => {
          e.closeTimer = null
          if (e.listeners.size === 0) {
            e.closed = true
            entries.delete(e.topic)
          }
        }, CLOSE_GRACE_MS)
      }
    },
    sendTyping(scope) {
      if (kind !== 'channel' || !opts.track) return
      const now = Date.now()
      if (now - poller.lastTypingAt < TYPING_SEND_MIN_MS) return
      poller.lastTypingAt = now
      // 즉시 폴하지 않는다 — 다음 폴에 실린다(계약 §5)
      poller.typing = { channelId, scope: scope ?? null }
    },
    getStatus: () => e.status,
    getOnline: () => e.online,
  }
}
