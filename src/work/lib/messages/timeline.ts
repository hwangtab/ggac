import { seoulDayKey } from './format'
import {
  sortAttachments,
  type AttachmentRow,
  type ChatMessage,
  type MessageCursor,
  type MessagePage,
  type MessageRow,
  type ReactionLite,
} from './types'

/**
 * 타임라인 상태(순수). 서버 조회·낙관적 전송·실시간 이벤트가 모두 이 리듀서를 거친다.
 * 메시지 id 는 클라이언트가 미리 만들므로, 낙관적 행과 서버 확정·실시간 INSERT 가 같은 id 로 합쳐진다.
 */

export type TimelineState = {
  /** 오래된 것 → 최신 */
  messages: ChatMessage[]
  hasMore: boolean
}

export type ReactionEvent = { message_id: string; user_id: string; emoji: string }

/**
 * 'record' 액션이 받는 행 — 서버에서 다시 읽은 ChatMessage(반응·첨부 포함) 또는 반응 없는 레코드.
 * reactions/attachments 가 있으면 그것이 정본이고, 없으면 기존 행의 값을 이어받는다.
 */
// ggac 이식: 'rev'(폴링 커서, 1a의 MessageRow에 더한 열)는 화면 행(ChatMessage)에 없어 함께 뺀다
export type RecordLike = Omit<
  MessageRow,
  'sensitive' | 'quoted_message_id' | 'forwarded_from_id' | 'rev'
> &
  Partial<
    Pick<
      ChatMessage,
      | 'reactions'
      | 'attachments'
      | 'quoted_message_id'
      | 'quoted'
      | 'forwarded_from_id'
      | 'forwarded'
    >
  >

export type TimelineAction =
  | { type: 'reset'; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'prepend'; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'merge'; messages: ChatMessage[] }
  /**
   * 재연결 보충 결과가 기존 목록과 이어지지 않을 때(사이에 메시지가 너무 많음) 목록을 최신 페이지로 바꾼다.
   * 서버 확정 전의 낙관적 행(status)은 남긴다. hasMore 는 최신 페이지 기준이라 이전 불러오기가 그대로 이어진다.
   */
  | { type: 'replaceLatest'; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'upsert'; message: ChatMessage }
  /**
   * 실시간 레코드(반응 없음) — 기존 반응을 유지한 채 열만 갱신.
   * 화면에 없는 메시지라도 불러온 범위 안(가장 오래된 것보다 새것)이면 붙인다(놓친 INSERT 보충).
   * 불러온 범위보다 오래된 메시지의 변경(옛 스레드에 답글 → 부모 reply_count UPDATE 등)은 무시한다 —
   * 그대로 붙이면 몇 주 전 메시지가 타임라인 맨 위에 맥락 없이 끼어든다.
   */
  | { type: 'record'; record: RecordLike }
  | { type: 'remove'; id: string }
  | { type: 'status'; id: string; status: ChatMessage['status'] }
  | { type: 'reaction'; op: 'add' | 'remove'; reaction: ReactionEvent }
  /**
   * 첨부 확정(attachTo 결과) 또는 실시간 UPDATE 뒤 다시 읽은 첨부. 같은 id 는 새 값으로 바꾸고 나머지는 합친다.
   * replace=true 면 주어진 목록이 정본이다(서버에서 다시 읽은 전체 목록).
   */
  | { type: 'attachments'; id: string; attachments: AttachmentRow[]; replace?: boolean }

export function compareMessages(a: Pick<ChatMessage, 'created_at' | 'id'>, b: typeof a): number {
  const ta = Date.parse(a.created_at)
  const tb = Date.parse(b.created_at)
  if (ta !== tb) return ta - tb
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 실시간 레코드 → ChatMessage. 레코드에 반응·첨부가 없으면 기존 행의 것을 이어받는다.
 * 낙관 상태(status)는 넘기지 않는다(서버 행이 오면 확정).
 */
export function fromRecord(record: RecordLike, existing?: ChatMessage): ChatMessage {
  return {
    id: record.id,
    channel_id: record.channel_id,
    parent_id: record.parent_id,
    author_id: record.author_id,
    kind: record.kind,
    body: record.body,
    attachments_count: record.attachments_count,
    reply_count: record.reply_count,
    last_reply_at: record.last_reply_at,
    edited_at: record.edited_at,
    deleted_at: record.deleted_at,
    created_at: record.created_at,
    reactions: record.reactions ?? existing?.reactions ?? [],
    // 첨부 임베드가 없는 레코드면 이미 알던 첨부를 유지한다
    attachments: record.attachments
      ? sortAttachments(record.attachments)
      : (existing?.attachments ?? []),
    // 인용·전달 요약은 서버가 임베드로 준 값이 정본(없는 레코드면 이어받는다)
    quoted_message_id: record.quoted_message_id ?? existing?.quoted_message_id ?? null,
    quoted: record.quoted !== undefined ? record.quoted : (existing?.quoted ?? null),
    forwarded_from_id: record.forwarded_from_id ?? existing?.forwarded_from_id ?? null,
    forwarded: record.forwarded !== undefined ? record.forwarded : (existing?.forwarded ?? null),
  }
}

/** 첨부 목록 합치기(id 기준, 올린 순서 정렬) */
export function mergeAttachments(
  current: AttachmentRow[],
  incoming: AttachmentRow[],
  replace = false
): AttachmentRow[] {
  if (replace) return sortAttachments(incoming)
  const byId = new Map(current.map(a => [a.id, a]))
  for (const a of incoming) byId.set(a.id, a)
  return sortAttachments([...byId.values()])
}

/** 실시간 레코드가 알려 준 첨부 수가 화면에 있는 첨부보다 많으면 다시 읽어야 한다 */
export function needsAttachmentRefetch(
  record: Pick<RecordLike, 'attachments_count' | 'deleted_at' | 'attachments'>,
  existing?: ChatMessage
): boolean {
  if (record.deleted_at) return false
  const known = record.attachments?.length ?? existing?.attachments.length ?? 0
  return record.attachments_count > known
}

/** 서버 조회 행·확정 행이 기존(낙관) 행을 대체한다. 반응도 서버 쪽이 정본이다 */
function mergeOne(prev: ChatMessage | undefined, next: ChatMessage): ChatMessage {
  if (!prev) return next
  return { ...next }
}

function mergeMany(list: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(list.map(m => [m.id, m]))
  for (const m of incoming) byId.set(m.id, mergeOne(byId.get(m.id), m))
  return [...byId.values()].sort(compareMessages)
}

function toggleReaction(
  reactions: ReactionLite[],
  op: 'add' | 'remove',
  r: ReactionEvent
): ReactionLite[] {
  const exists = reactions.some(x => x.emoji === r.emoji && x.user_id === r.user_id)
  if (op === 'add')
    return exists ? reactions : [...reactions, { emoji: r.emoji, user_id: r.user_id }]
  return exists
    ? reactions.filter(x => !(x.emoji === r.emoji && x.user_id === r.user_id))
    : reactions
}

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case 'reset':
      return { messages: [...action.messages].sort(compareMessages), hasMore: action.hasMore }
    case 'prepend':
      return { messages: mergeMany(state.messages, action.messages), hasMore: action.hasMore }
    case 'merge':
      return { ...state, messages: mergeMany(state.messages, action.messages) }
    case 'replaceLatest': {
      const pending = state.messages.filter(m => m.status)
      return { messages: mergeMany(pending, action.messages), hasMore: action.hasMore }
    }
    case 'upsert': {
      const idx = state.messages.findIndex(m => m.id === action.message.id)
      if (idx === -1) return { ...state, messages: mergeMany(state.messages, [action.message]) }
      const next = state.messages.slice()
      next[idx] = mergeOne(state.messages[idx], action.message)
      // 서버 created_at 이 낙관 시각과 다를 수 있다 — 다시 정렬
      return { ...state, messages: next.sort(compareMessages) }
    }
    case 'record': {
      const existing = state.messages.find(m => m.id === action.record.id)
      if (!existing && state.hasMore) {
        const oldest = state.messages.find(m => !m.status)
        if (oldest && compareMessages(action.record, oldest) < 0) return state
      }
      return timelineReducer(state, {
        type: 'upsert',
        message: fromRecord(action.record, existing),
      })
    }
    case 'remove':
      return { ...state, messages: state.messages.filter(m => m.id !== action.id) }
    case 'status':
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === action.id ? { ...m, status: action.status } : m
        ),
      }
    case 'reaction': {
      let changed = false
      const messages = state.messages.map(m => {
        if (m.id !== action.reaction.message_id) return m
        const reactions = toggleReaction(m.reactions, action.op, action.reaction)
        if (reactions === m.reactions) return m
        changed = true
        return { ...m, reactions }
      })
      return changed ? { ...state, messages } : state
    }
    case 'attachments': {
      const idx = state.messages.findIndex(m => m.id === action.id)
      if (idx === -1) return state
      const m = state.messages[idx]
      const attachments = mergeAttachments(m.attachments, action.attachments, action.replace)
      const next = state.messages.slice()
      next[idx] = {
        ...m,
        attachments,
        attachments_count: Math.max(
          action.replace ? attachments.length : m.attachments_count,
          attachments.length
        ),
      }
      return { ...state, messages: next }
    }
  }
}

/** 반응을 이모지별로 묶는다(처음 나온 순서 유지) */
export function groupReactions(
  reactions: ReactionLite[],
  me: string
): { emoji: string; count: number; mine: boolean; userIds: string[] }[] {
  const groups = new Map<
    string,
    { emoji: string; count: number; mine: boolean; userIds: string[] }
  >()
  for (const r of reactions) {
    const g = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, userIds: [] }
    g.count += 1
    g.userIds.push(r.user_id)
    if (r.user_id === me) g.mine = true
    groups.set(r.emoji, g)
  }
  return [...groups.values()]
}

export type TimelineItem =
  | { type: 'day'; key: string; day: string }
  | { type: 'new'; key: string }
  | { type: 'message'; key: string; message: ChatMessage; compact: boolean }
  /** 같은 최상위 폴더의 이관 시스템 메시지가 연속으로 IMPORT_GROUP_MIN 건 이상 — 한 묶음으로 접는다 */
  | { type: 'import-group'; key: string; messages: ChatMessage[]; root: string; fileCount: number }

/** 이관 시스템 메시지(첨부가 달린 system 메시지)인가 */
export function isImportMessage(m: ChatMessage): boolean {
  return m.kind === 'system' && !m.deleted_at && m.attachments.length > 0
}

/** 이관 메시지의 최상위 폴더(폴더 경로 첫 구간). 폴더 정보가 없으면 '' */
export function importRootOf(m: ChatMessage): string {
  const folder = m.attachments.find(a => a.folder_path)?.folder_path ?? ''
  const slash = folder.indexOf('/')
  return slash === -1 ? folder : folder.slice(0, slash)
}

/** 이 수 이상 연속되면 묶는다 */
export const IMPORT_GROUP_MIN = 3

/** 연속된 같은 폴더의 이관 메시지를 import-group 항목으로 접는다(날짜·새 메시지 선이 사이에 있으면 끊긴다) */
function collapseImportRuns(items: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = []
  let run: ChatMessage[] = []
  let runRoot = ''
  const flush = () => {
    if (run.length >= IMPORT_GROUP_MIN) {
      out.push({
        type: 'import-group',
        key: `import:${run[0].id}`,
        messages: run,
        root: runRoot,
        fileCount: run.reduce((n, m) => n + m.attachments.length, 0),
      })
    } else {
      for (const m of run) out.push({ type: 'message', key: m.id, message: m, compact: false })
    }
    run = []
  }
  for (const item of items) {
    if (item.type === 'message' && isImportMessage(item.message)) {
      const root = importRootOf(item.message)
      if (run.length > 0 && root !== runRoot) flush()
      runRoot = root
      run.push(item.message)
      continue
    }
    flush()
    out.push(item)
  }
  flush()
  return out
}

/** 같은 작성자가 5분 안에 이어 쓰면 머리글(이름·시각)을 생략한다 */
const GROUP_WINDOW_MS = 5 * 60 * 1000

/**
 * 날짜 구분선 · "새 메시지" 선 · 연속 메시지 묶음 · 이관 메시지 묶음(import-group).
 * - 삭제된 메시지는 답글이 있을 때만 자리표시로 남긴다.
 * - "새 메시지" 선: lastReadAt 이후 남이 쓴 첫 메시지 앞(한 번만).
 */
export function buildTimelineItems(
  messages: ChatMessage[],
  opts: { lastReadAt: string | null; me: string }
): TimelineItem[] {
  const items: TimelineItem[] = []
  const lastRead = opts.lastReadAt ? Date.parse(opts.lastReadAt) : null
  let prevDay: string | null = null
  let prev: ChatMessage | null = null
  let newPlaced = false
  for (const m of messages) {
    if (m.deleted_at && m.reply_count === 0) continue
    const day = seoulDayKey(m.created_at)
    let breakGroup = false
    if (day !== prevDay) {
      items.push({ type: 'day', key: `day:${day}`, day })
      prevDay = day
      breakGroup = true
    }
    if (
      !newPlaced &&
      lastRead !== null &&
      !m.status &&
      m.author_id !== opts.me &&
      Date.parse(m.created_at) > lastRead
    ) {
      items.push({ type: 'new', key: 'new-messages' })
      newPlaced = true
      breakGroup = true
    }
    const compact =
      !breakGroup &&
      prev !== null &&
      !prev.deleted_at &&
      !m.deleted_at &&
      prev.author_id === m.author_id &&
      prev.kind === m.kind &&
      Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_WINDOW_MS
    items.push({ type: 'message', key: m.id, message: m, compact })
    prev = m
  }
  return collapseImportRuns(items)
}

/** ↑ 키로 고칠 내 마지막 메시지 */
export function lastEditableMessage(messages: ChatMessage[], me: string): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.author_id === me && !m.deleted_at && !m.status && m.kind === 'text') return m
  }
  return null
}

// ── 재연결 보충(빈틈 메우기) ────────────────────────────────────────────────────

/** 빈틈을 커서로 이어 받을 최대 페이지 수(50개씩) — 넘으면 최신 페이지로 교체 */
export const CATCH_UP_MAX_PAGES = 4

/** 서버에서 확정된(낙관적이 아닌) 가장 최신 메시지 */
function newestConfirmed(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].status) return messages[i]
  return undefined
}

/**
 * 재연결로 받은 최신 페이지가 기존 목록과 이어지는가. 이어지지 않으면(페이지의 가장 오래된 것이
 * 기존의 가장 최신보다 새롭고, 그보다 더 오래된 메시지가 서버에 있다) 가운데가 빈다.
 */
export function hasCatchUpGap(existing: ChatMessage[], latest: MessagePage): boolean {
  if (!latest.hasMore || latest.messages.length === 0) return false
  const newest = newestConfirmed(existing)
  if (!newest) return false
  return compareMessages(latest.messages[0], newest) > 0
}

export type CatchUpResult = {
  action: Extract<TimelineAction, { type: 'merge' | 'replaceLatest' }>
  /** true 면 빈틈이 너무 커서 목록을 최신 페이지로 바꿨다(안내를 보여 준다) */
  truncated: boolean
}

/**
 * 재연결 보충 계획(순수 — 이전 페이지 조회는 주입). 겹치면 그대로 합치고, 빈틈이 있으면 커서로
 * 최대 CATCH_UP_MAX_PAGES 쪽을 거슬러 올라 이어 받는다. 끝내 못 잇거나 조회가 실패하면 최신 페이지로 교체한다.
 */
export async function planCatchUp(
  existing: ChatMessage[],
  latest: MessagePage,
  fetchOlder: (before: MessageCursor) => Promise<MessagePage | null>
): Promise<CatchUpResult> {
  if (!hasCatchUpGap(existing, latest)) {
    return { action: { type: 'merge', messages: latest.messages }, truncated: false }
  }
  const newest = newestConfirmed(existing) as ChatMessage
  let collected = latest.messages
  for (let i = 0; i < CATCH_UP_MAX_PAGES; i++) {
    const oldest = collected[0]
    const page = await fetchOlder({ created_at: oldest.created_at, id: oldest.id })
    if (!page) break
    if (page.messages.length === 0) {
      return { action: { type: 'merge', messages: collected }, truncated: false }
    }
    collected = [...page.messages, ...collected]
    if (!page.hasMore || compareMessages(page.messages[0], newest) <= 0) {
      return { action: { type: 'merge', messages: collected }, truncated: false }
    }
  }
  return {
    action: { type: 'replaceLatest', messages: latest.messages, hasMore: latest.hasMore },
    truncated: true,
  }
}
