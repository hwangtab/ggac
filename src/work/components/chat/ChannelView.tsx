'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { useSidebarBadges } from '@work/components/layout/sidebar-badges'
import { useShellData } from '@work/components/layout/shell-context'
import { MessagesSquareIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { useRightPanel } from '@work/components/layout/RightPanel'
import { joinChannel, markChannelRead, setChannelStarred } from '@work/lib/channels/actions'
import { setChannelNotifyLevel } from '@work/lib/notifications/actions'
import {
  effectiveNotifyLevel,
  notifyLevelOptions,
  type NotifyLevel,
} from '@work/lib/notifications/levels'
import { activeStatus, statusLine } from '@work/lib/notifications/status'
import type {
  ChannelDetail,
  ChannelMemberSummary,
  MyMembership,
  StaffSummary,
} from '@work/lib/channels/types'
import {
  loadLatestMessages,
  loadMessagesByIds,
  loadOlderMessages,
  loadPinnedIds,
  toggleBookmark,
  togglePin,
} from '@work/lib/messages/actions'
import { canPostTopLevel, POST_RESTRICTED_NOTICE } from '@work/lib/channels/post-policy'
import { draftKey } from '@work/lib/messages/drafts'
import { reloadIfIdle } from '@work/lib/messages/stale-deploy'
import { messageIdFromHash } from '@work/lib/messages/anchor'
import { toQuoteTarget, type QuoteTarget } from '@work/lib/messages/quote'
import type { TopicEvent } from '@work/lib/messages/realtime'
import {
  lastEditableMessage,
  needsAttachmentRefetch,
  planCatchUp,
  timelineReducer,
  type TimelineState,
} from '@work/lib/messages/timeline'
import type { ChatMessage, MessagePage } from '@work/lib/messages/types'
import type { TabBarData } from '@work/lib/tabs/types'
import AttachmentPicker from '@work/components/files/AttachmentPicker'
import { useCreateDocument } from '@work/components/files/create-document/use-create-document'
import type { MentionMember } from './ChatMarkdown'
import ChannelHeader from './ChannelHeader'
import ConversationTabBar from './ConversationTabBar'
import { conversationBasePath } from './conversation-tabs'
import {
  createChannelInfoStore,
  type ChannelInfoQuick,
  LiveChannelInfoPanel,
  type ChannelInfoStore,
} from './ChannelInfoPanel'
import { ConnectionBadge, TypingIndicator } from './ChatStatus'
import MessageComposer, { type MentionCandidate } from './MessageComposer'
import MessageList from './MessageList'
import PinnedPanel from './PinnedPanel'
import QuotePreview from './QuotePreview'
import ThreadPanel from './ThreadPanel'
import { useChannelTopic, useOnlineStatus } from './use-channel-topic'
import { useAttachmentSync } from './use-attachment-sync'
import { useComposerAttachments } from './use-composer-attachments'
import { useForward } from './use-forward'
import { useMessageOps } from './use-message-ops'

export type ChannelViewMe = {
  id: string
  displayName: string
  isAdmin: boolean
  /** 서브관리자(guest) — 새 문서 만들기를 숨긴다 */
  isGuest?: boolean
}

export type ChannelViewProps = {
  channel: ChannelDetail
  /** null 이면 멤버가 아닌 공개 채널 미리보기(읽기 전용) */
  membership: MyMembership | null
  me: ChannelViewMe
  staff: StaffSummary[]
  members: ChannelMemberSummary[]
  initialPage: MessagePage
  pinnedIds: string[]
  bookmarkedIds: string[]
  /** DM 상대 */
  peerId?: string | null
  /** ?thread=<부모 id> — 들어오면 그 스레드 패널을 열고 주소의 #msg-<답글 id> 를 강조한다(QA #2) */
  threadId?: string | null
  /** 대화 탭 바 데이터(추가 탭·권한). 없으면 기본 탭만 그린다 */
  tabBar?: TabBarData
  /** ggac 이식(폴링): 이 첫 페이지를 읽은 시점의 채널 rev — 폴링 시작 커서(loadChannelViewData().rev) */
  rev?: number
}

const READ_DEBOUNCE_MS = 800

/**
 * 채널·DM 화면(클라이언트): 머리글 · 타임라인 · 입력창 · 실시간 · Presence · 입력 중 · 읽음 처리.
 * 서버 컴포넌트(c/[slug], dm/[id])가 첫 페이지와 디렉터리를 넘겨준다. 이후 상태는 리듀서 하나가 쥔다.
 */
/** 재연결 뒤 다시 읽는 오래된(받은 범위 밖) 메시지 수 상한 — 그보다 위는 다시 스크롤하면 새로 읽는다 */
const STALE_RECHECK_MAX = 300

export default function ChannelView({
  channel,
  membership,
  me,
  staff,
  members,
  initialPage,
  pinnedIds: initialPinned,
  bookmarkedIds: initialBookmarks,
  peerId = null,
  threadId = null,
  tabBar,
  rev,
}: ChannelViewProps) {
  const router = useRouter()
  const sidebarBadges = useSidebarBadges()
  // 읽음 응답은 늦게 올 수 있다 — 타이머가 만들어질 때의 값이 아니라 응답 시점의 최신 셸 통로를 쓴다
  const sidebarBadgesRef = useRef(sidebarBadges)
  sidebarBadgesRef.current = sidebarBadges
  const panel = useRightPanel()
  const [state, dispatch] = useReducer(
    timelineReducer,
    initialPage,
    (p): TimelineState => ({
      messages: p.messages,
      hasMore: p.hasMore,
    })
  )
  const [lastReadAt] = useState(membership?.last_read_at ?? null)
  const [pinned, setPinned] = useState(() => new Set(initialPinned))
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const [bookmarks, setBookmarks] = useState(() => new Set(initialBookmarks))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // 고정(별) 단일 출처 = 셸의 사이드바 목록(낙관적 값 포함). 셸 밖(테스트·단독 렌더)이거나 목록에 없는 채널이면
  // 이 화면의 로컬 상태로 폴백한다.
  const shell = useShellData()
  const shellItem = shell.onTogglePin
    ? ([...shell.channels, ...shell.dms].find(i => i.id === channel.id) ?? null)
    : null
  const [localStarred, setLocalStarred] = useState(membership?.starred ?? false)
  const starred = shellItem ? shellItem.starred : localStarred
  const [notifyLevel, setNotifyLevel] = useState<NotifyLevel>(() =>
    effectiveNotifyLevel(
      membership?.notify_level ?? (membership?.muted ? 'off' : null),
      channel.kind
    )
  )
  const [error, setError] = useState<string | null>(null)
  const [joining, startJoin] = useTransition()
  const isMember = membership !== null
  const isGroup = channel.kind === 'dm' && channel.isGroup
  // isDm 은 1:1 DM 만. 그룹 채팅(0016)은 멤버 목록·@channel 이 있다
  const isDm = channel.kind === 'dm' && !isGroup
  const archived = channel.archived_at !== null
  const canWrite = isMember && !archived
  // 공지 채널(0028): 최상위 글은 채널 owner·관리자만. 답글은 스레드에서 누구나
  const canPostHere =
    canWrite &&
    canPostTopLevel({
      policy: channel.postPolicy,
      isChannelOwner: membership?.role === 'owner',
      isWorkAdmin: me.isAdmin,
    })
  const announcementOnly = canWrite && !canPostHere
  // 새 문서 만들기(docs/16) — 스레드 안 생성은 ThreadPanel 이 같은 판정을 쓴다
  const createDocActor = useMemo(
    () => ({
      isGuest: me.isGuest ?? false,
      isMember,
      archived,
      postPolicy: channel.postPolicy,
      isChannelOwner: membership?.role === 'owner',
      isAdmin: me.isAdmin,
    }),
    [me.isGuest, me.isAdmin, isMember, archived, channel.postPolicy, membership?.role]
  )
  const createDoc = useCreateDocument({ channelId: channel.id, actor: createDocActor })

  // ── 이름표 ────────────────────────────────────────────────────────────────
  const staffMap = useMemo(() => new Map(staff.map(s => [s.user_id, s])), [staff])
  const nameOf = useCallback(
    (userId: string | null) =>
      userId ? (staffMap.get(userId)?.display_name ?? '알 수 없는 사용자') : '시스템',
    [staffMap]
  )
  // 상태 메시지(0027) — 렌더 때 만료를 거른다(오래 열어 둔 화면에서도 지난 상태가 남지 않게)
  const statusOf = useCallback(
    (userId: string | null) => (userId ? statusLine(activeStatus(staffMap.get(userId))) : ''),
    [staffMap]
  )
  const mentionCandidates = useMemo<MentionCandidate[]>(
    () =>
      members
        .filter(m => m.user_id !== me.id)
        .map(m => staffMap.get(m.user_id))
        .filter((s): s is StaffSummary => !!s && s.status === 'active')
        .map(s => ({
          id: s.user_id,
          name: s.display_name,
          title: s.title,
          status: statusLine(activeStatus(s)) || null,
        })),
    [members, staffMap, me.id]
  )
  // 멘션 칩 이름 표시용: 나를 포함한 채널 멤버 전원(비활성 포함) — 토큰에 적힌 이름 대신 이 이름을 쓴다
  const mentionMembers = useMemo<MentionMember[]>(
    () =>
      members.flatMap(m => {
        const s = staffMap.get(m.user_id)
        return s ? [{ id: s.user_id, name: s.display_name }] : []
      }),
    [members, staffMap]
  )

  // ── 오류 표시(5초 뒤 사라짐) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(t)
  }, [error])

  const ops = useMessageOps({ dispatch, me: me.id, onError: setError })
  // 인용 답장(0028) — 입력창 위 미리보기. 보내면 비운다
  const [quote, setQuote] = useState<QuoteTarget | null>(null)
  const [focusSignal, setFocusSignal] = useState(0)
  const onQuote = useCallback((m: ChatMessage) => {
    setQuote(toQuoteTarget(m))
    setFocusSignal(n => n + 1)
  }, [])
  const fwd = useForward({ sourceKind: channel.kind, nameOf })
  const attachments = useComposerAttachments({
    channelId: channel.id,
    onAttached: (id, list) => dispatch({ type: 'attachments', id, attachments: list }),
  })
  const syncAttachments = useAttachmentSync(dispatch)

  // ── 읽음 처리 ─────────────────────────────────────────────────────────────
  const messagesRef = useRef(state.messages)
  messagesRef.current = state.messages
  const lastMarkedRef = useRef(lastReadAt ? Date.parse(lastReadAt) : 0)
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstMarkRef = useRef(true)

  const markRead = useCallback(() => {
    if (!isMember) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const latestOther = messagesRef.current.reduce(
      (max, m) =>
        m.author_id !== me.id && !m.status ? Math.max(max, Date.parse(m.created_at)) : max,
      0
    )
    if (!firstMarkRef.current && latestOther <= lastMarkedRef.current) return
    if (readTimerRef.current) clearTimeout(readTimerRef.current)
    readTimerRef.current = setTimeout(async () => {
      readTimerRef.current = null
      const hadUnread = latestOther > lastMarkedRef.current
      const first = firstMarkRef.current
      firstMarkRef.current = false
      const res = await markChannelRead({ channelId: channel.id })
      if (!res.ok) return
      lastMarkedRef.current = Date.parse(res.data.readAt)
      // 사이드바 배지를 맞춘다 — 들어올 때 안 읽은 것이 있었거나, 멘션을 읽음으로 바꿨을 때만
      // (스레드 답글의 멘션은 타임라인에 안 보여 hadUnread 로는 알 수 없다 → 서버가 알려 준 수로 판단).
      // 셸 안이면 클라이언트에서 바로 지운다 — router.refresh 는 레이아웃·페이지를 통째로 다시 조회한다.
      const cleared = res.data.clearedMentions ?? 0
      if (!(first && hadUnread) && cleared === 0) return
      const badgesApi = sidebarBadgesRef.current
      if (badgesApi) badgesApi.markRead(channel.id, cleared)
      else router.refresh()
    }, READ_DEBOUNCE_MS)
  }, [isMember, me.id, channel.id, router])

  useEffect(() => {
    markRead()
    const onVisible = () => {
      if (document.visibilityState === 'visible') markRead()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (readTimerRef.current) clearTimeout(readTimerRef.current)
    }
  }, [markRead])

  // ── 실시간 ───────────────────────────────────────────────────────────────
  // 첫 페이지는 서버 렌더 시점의 스냅숏이다. 구독이 붙기 전(하이드레이션·join 왕복) 사이에 온 메시지는
  // 실시간으로 오지 않으므로, 처음 연결됐을 때 한 번 최신 페이지를 다시 읽어 빈틈을 메운다.
  const syncedRef = useRef(false)
  const wasDownRef = useRef(false)
  // 실시간 재조회가 끝내 실패했을 때의 안내(failed) · 배포로 낡은 탭(stale)
  const [syncNotice, setSyncNotice] = useState<'failed' | 'stale' | null>(null)
  const uploadBusyRef = useRef(false)
  const catchingUpRef = useRef(false)
  const resyncPendingRef = useRef(false)
  const [catchUpNotice, setCatchUpNotice] = useState(false)
  const refetchLatest = useCallback(async () => {
    // 재연결·온라인 복귀가 겹쳐도 한 번에 하나만(빈틈 이어 받기는 여러 번 왕복한다)
    if (catchingUpRef.current) return
    catchingUpRef.current = true
    try {
      const res = await loadLatestMessages({ channelId: channel.id })
      if (!res?.ok) return
      // 오래 끊겼다 돌아오면 최신 50개가 기존 목록과 안 이어질 수 있다 — 사이를 커서로 이어 받는다
      const plan = await planCatchUp(messagesRef.current, res.data, async before => {
        try {
          const older = await loadOlderMessages({ channelId: channel.id, before })
          return older.ok ? older.data : null
        } catch (e) {
          console.error('[refetchLatest] 빈틈 보충', e)
          return null
        }
      })
      const before = messagesRef.current
      dispatch(plan.action)
      if (plan.truncated) setCatchUpNotice(true)
      // 다시 받은 범위 **밖**(위로 스크롤해 이미 불러 둔 오래된 메시지)은 그 사이의 수정·삭제·반응이 반영되지 않았다 —
      // 오래 숨겨 둔 탭이 200건 넘게 밀려 재동기화되면 지워진 글이 새로 고칠 때까지 남았다(2026-11-05 점검). 합친 경우에만
      // (최신으로 바꾼 경우는 이미 버렸다) 그 메시지들을 id 로 다시 읽어 고치고, 읽히지 않는 것은 목록에서 뺀다.
      // 재동기화(커서 건너뜀)일 때만 — 보통 재연결은 커서가 이어져 그 사이 바뀐 것이 폴링으로 온다(매 재연결마다 다시 읽지
      // 않게, 그리고 그 사이 도착한 실시간 갱신을 옛 스냅숏으로 덮지 않게 — 2026-11-05 회귀 리뷰)
      const recheckOld = resyncPendingRef.current
      resyncPendingRef.current = false
      if (recheckOld && plan.action.type === 'merge') {
        const fetched = new Set(plan.action.messages.map(m => m.id))
        const stale = before
          .filter(m => !m.status && !fetched.has(m.id))
          .map(m => m.id)
          .slice(-STALE_RECHECK_MAX)
        for (let i = 0; i < stale.length; i += 100) {
          const ids = stale.slice(i, i + 100)
          const again = await loadMessagesByIds({ messageIds: ids })
          if (!again?.ok) break
          const got = new Map(
            again.data.filter(m => m.channel_id === channel.id).map(m => [m.id, m])
          )
          for (const id of ids) {
            const row = got.get(id)
            if (row) dispatch({ type: 'upsert', message: row })
            else dispatch({ type: 'remove', id })
          }
        }
      }
    } catch (e) {
      console.error('[refetchLatest]', e)
    } finally {
      catchingUpRef.current = false
    }
  }, [channel.id])

  useEffect(() => {
    if (!catchUpNotice) return
    const t = setTimeout(() => setCatchUpNotice(false), 10_000)
    return () => clearTimeout(t)
  }, [catchUpNotice])

  // 고정 수(머리글)를 서버 기준으로 다시 맞춘다 — 남이 고정·해제했다는 실시간 신호(0014)를 받았을 때
  const refetchPins = useCallback(async () => {
    let res: Awaited<ReturnType<typeof loadPinnedIds>> | undefined
    try {
      res = await loadPinnedIds({ channelId: channel.id })
    } catch (e) {
      console.error('[refetchPins]', e)
      return
    }
    if (res?.ok) setPinned(new Set(res.data))
  }, [channel.id])

  const unpinLocally = useCallback((id: string) => {
    setPinned(s => {
      if (!s.has(id)) return s
      const next = new Set(s)
      next.delete(id)
      return next
    })
  }, [])

  const onEvent = useCallback(
    (event: TopicEvent) => {
      if (event.type === 'pins') {
        void refetchPins()
        return
      }
      if (event.type === 'message') {
        const rec = event.record ?? event.old
        if (!rec || rec.channel_id !== channel.id) return
        // 지워진 메시지는 고정 목록에서도 빠진다(RLS pins_live_select) — 머리글 수를 바로 맞춘다
        if (event.op === 'DELETE' || event.record?.deleted_at) unpinLocally(rec.id)
        // 그룹의 멤버 변동·이름 변경은 시스템 메시지로 알려진다 — 서버 값(머리글 이름·멤버 수)을 다시 읽는다
        if (
          isGroup &&
          event.op === 'INSERT' &&
          event.record?.kind === 'system' &&
          event.record.author_id !== me.id
        ) {
          router.refresh()
        }
        if (rec.parent_id) return
        if (event.op === 'DELETE') dispatch({ type: 'remove', id: rec.id })
        else if (event.record) {
          const existing = messagesRef.current.find(m => m.id === event.record?.id)
          dispatch({ type: 'record', record: event.record })
          if (needsAttachmentRefetch(event.record, existing)) syncAttachments(event.record.id)
        }
      } else if (event.type === 'reaction') {
        const r = event.record ?? event.old
        if (r)
          dispatch({ type: 'reaction', op: event.op === 'INSERT' ? 'add' : 'remove', reaction: r })
      } else if (event.type === 'sync-lost') {
        if (event.reason === 'stale-deploy') {
          // 새 배포로 낡은 탭이다 — 쓰는 중이 아니면(임시 저장은 localStorage 에 있다) 한 번 자동 새로고침
          if (!reloadIfIdle({ busy: uploadBusyRef.current })) setSyncNotice('stale')
        } else {
          setSyncNotice(cur => cur ?? 'failed')
        }
      } else if (event.type === 'resync') {
        // 이어지는 재연결의 최신 페이지 다시 읽기에서 받은 범위 밖 오래된 메시지도 다시 읽게 표시한다
        resyncPendingRef.current = true
      } else if (event.type === 'sync-ok') {
        setSyncNotice(cur => (cur === 'failed' ? null : cur))
        void refetchLatest()
      } else if (event.type === 'status') {
        if (event.status === 'error' || event.status === 'closed') wasDownRef.current = true
        else if (event.status === 'connected' && (wasDownRef.current || !syncedRef.current)) {
          wasDownRef.current = false
          syncedRef.current = true
          void refetchLatest()
        }
      }
    },
    [channel.id, isGroup, me.id, router, refetchLatest, syncAttachments, refetchPins, unpinLocally]
  )

  const track = useMemo(
    () => (isMember ? { user_id: me.id, display_name: me.displayName } : null),
    [isMember, me.id, me.displayName]
  )
  const topic = useChannelTopic(isMember ? channel.id : null, { track, onEvent, rev })
  const networkOnline = useOnlineStatus()
  uploadBusyRef.current = Boolean(attachments.sendBlocked)

  // 네트워크가 돌아오면 빈틈을 메운다
  const prevNetRef = useRef(networkOnline)
  useEffect(() => {
    if (networkOnline && !prevNetRef.current && isMember) void refetchLatest()
    prevNetRef.current = networkOnline
  }, [networkOnline, isMember, refetchLatest])

  // ── 이전 페이지 ───────────────────────────────────────────────────────────
  // 스크롤 이벤트는 렌더보다 자주 온다 — state 만으로 막으면 같은 커서로 두세 번 부른다(ref 로 즉시 잠금)
  const loadingOlderRef = useRef(false)
  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current.find(m => !m.status)
    if (!oldest || loadingOlderRef.current) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    let res: Awaited<ReturnType<typeof loadOlderMessages>>
    try {
      res = await loadOlderMessages({
        channelId: channel.id,
        before: { created_at: oldest.created_at, id: oldest.id },
      })
    } catch (e) {
      console.error('[loadOlder]', e)
      res = { ok: false, error: '이전 메시지를 불러오지 못했습니다.' }
    }
    loadingOlderRef.current = false
    setLoadingOlder(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    dispatch({ type: 'prepend', messages: res.data.messages, hasMore: res.data.hasMore })
  }, [channel.id])

  // ── 우측 패널 ─────────────────────────────────────────────────────────────
  const panelRef = useRef(panel)
  panelRef.current = panel
  useEffect(() => {
    const id = channel.id
    return () => {
      // 다른 채널로 가면 이 채널의 스레드·정보 패널을 닫는다
      const key = panelRef.current.view?.key ?? ''
      if (key.endsWith(`@${id}`)) panelRef.current.close()
    }
  }, [channel.id])

  const openThreadById = useCallback(
    (parentId: string, initialParent: ChatMessage | null, highlightId: string | null = null) => {
      panel.open({
        key: `thread:${parentId}@${channel.id}`,
        title: '스레드',
        content: (
          <ThreadPanel
            key={`${parentId}:${highlightId ?? ''}`}
            channelId={channel.id}
            parentId={parentId}
            initialParent={initialParent}
            highlightId={highlightId}
            me={{ id: me.id, displayName: me.displayName }}
            nameOf={nameOf}
            statusOf={statusOf}
            mentionCandidates={mentionCandidates}
            members={mentionMembers}
            allowChannelMention={!isDm}
            readOnly={!canWrite}
            canModerate={me.isAdmin}
            channelKind={channel.kind}
            conversationBase={conversationBasePath(channel)}
            createDocActor={createDocActor}
          />
        ),
      })
    },
    [
      panel,
      channel,
      me,
      nameOf,
      statusOf,
      mentionCandidates,
      mentionMembers,
      isDm,
      canWrite,
      createDocActor,
    ]
  )
  const openThread = useCallback(
    (message: ChatMessage) => openThreadById(message.id, message),
    [openThreadById]
  )

  // ?thread=<부모 id> 로 들어오면(검색 결과·받은 멘션의 스레드 답글) 그 스레드를 열고 답글을 강조한다.
  // 부모가 불러온 50개 밖이어도 ThreadPanel 이 서버에서 읽는다. 같은 값으로 다시 렌더돼도 한 번만.
  const openThreadRef = useRef(openThreadById)
  openThreadRef.current = openThreadById
  useEffect(() => {
    if (!threadId) return
    const parent = messagesRef.current.find(m => m.id === threadId) ?? null
    const target = messageIdFromHash(window.location.hash)
    openThreadRef.current(threadId, parent, target && target !== threadId ? target : null)
  }, [threadId])

  // 정보 패널은 열 때의 스냅샷이 아니라 저장소를 구독한다 — 다른 사람이 사람을 추가하거나 이름을 바꾸거나
  // 나가서 channel·members 가 새로 오면(router.refresh) 열린 패널도 따라간다.
  // quick(고정 메시지·상단 고정·알림 수준)은 모바일 머리글에서 숨긴 단추의 같은 동작이다. 동작 함수는 아래에서 정의되므로
  // 최신 것을 ref 로 읽는 얇은 래퍼를 넘긴다(저장소 갱신이 매 렌더 일어나지 않게).
  const quickActionsRef = useRef<{
    flipStar: () => Promise<void>
    changeNotifyLevel: (level: NotifyLevel) => Promise<void>
    openPins: () => void
  } | null>(null)
  const notifyOptions = useMemo(
    () => notifyLevelOptions(channel.kind, channel.kind === 'dm' && channel.isGroup),
    [channel.kind, channel.isGroup]
  )
  const quick = useMemo<ChannelInfoQuick>(
    () => ({
      pinCount: pinned.size,
      onOpenPins: () => quickActionsRef.current?.openPins(),
      starred,
      onToggleStar: isMember ? () => void quickActionsRef.current?.flipStar() : undefined,
      notifyLevel,
      notifyOptions,
      onChangeNotifyLevel: isMember
        ? (level: NotifyLevel) => void quickActionsRef.current?.changeNotifyLevel(level)
        : undefined,
    }),
    [pinned.size, starred, isMember, notifyLevel, notifyOptions]
  )
  const infoProps = {
    channel,
    membership,
    meId: me.id,
    isAdmin: me.isAdmin,
    staff,
    members,
    quick,
  }
  const infoStoreRef = useRef<ChannelInfoStore | null>(null)
  if (!infoStoreRef.current) infoStoreRef.current = createChannelInfoStore(infoProps)
  const infoStore = infoStoreRef.current
  useEffect(() => {
    infoStore.set({ channel, membership, meId: me.id, isAdmin: me.isAdmin, staff, members, quick })
  }, [infoStore, channel, membership, me.id, me.isAdmin, staff, members, quick])

  const openInfo = useCallback(() => {
    panel.toggle({
      key: `info@${channel.id}`,
      title: isDm || isGroup ? '대화 정보' : `#${channel.name} 정보`,
      content: <LiveChannelInfoPanel store={infoStore} />,
    })
  }, [panel, channel.id, channel.name, isDm, isGroup, infoStore])

  // ── 고정 · 북마크(낙관적) ──────────────────────────────────────────────────
  const toggleSet = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const onTogglePin = useCallback(
    async (message: ChatMessage) => {
      setPinned(s => toggleSet(s, message.id))
      const res = await togglePin({ channelId: channel.id, messageId: message.id })
      if (!res.ok) {
        setPinned(s => toggleSet(s, message.id))
        setError(res.error)
        return
      }
      setPinned(s => {
        const next = new Set(s)
        if (res.data.pinned) next.add(message.id)
        else next.delete(message.id)
        return next
      })
    },
    [channel.id]
  )

  const openPins = useCallback(() => {
    panel.toggle({
      key: `pins@${channel.id}`,
      title: '고정 메시지',
      content: (
        <PinnedPanel
          channelId={channel.id}
          me={me.id}
          nameOf={nameOf}
          members={mentionMembers}
          onUnpin={canWrite ? m => void onTogglePin(m) : undefined}
        />
      ),
    })
  }, [panel, channel.id, me.id, nameOf, mentionMembers, canWrite, onTogglePin])

  // 고정된 메시지를 지우면 머리글 고정 수를 먼저 줄이고, 실패하면 되돌린다(QA #16)
  const onDeleteMessage = useCallback(
    async (message: ChatMessage) => {
      const wasPinned = pinnedRef.current.has(message.id)
      if (wasPinned) unpinLocally(message.id)
      const done = await ops.remove(message)
      if (!done && wasPinned) setPinned(s => new Set(s).add(message.id))
    },
    [ops, unpinLocally]
  )

  const onToggleBookmark = useCallback(async (message: ChatMessage) => {
    setBookmarks(s => toggleSet(s, message.id))
    const res = await toggleBookmark({ messageId: message.id })
    if (!res.ok) {
      setBookmarks(s => toggleSet(s, message.id))
      setError(res.error)
    }
  }, [])

  // ── 즐겨찾기 · 알림 수준 ──────────────────────────────────────────────────
  const shellTogglePin = shell.onTogglePin
  const flipStar = useCallback(async () => {
    if (shellItem && shellTogglePin) {
      // 사이드바와 같은 경로(낙관적 갱신·연타 순번·실패 되돌림·안내는 셸이 맡는다)
      shellTogglePin(shellItem, !shellItem.starred)
      return
    }
    const current = localStarred
    setLocalStarred(!current)
    const res = await setChannelStarred({ channelId: channel.id, value: !current })
    if (!res.ok) {
      setLocalStarred(current)
      setError(res.error)
    }
  }, [shellItem, shellTogglePin, localStarred, channel.id])

  const changeNotifyLevel = useCallback(
    async (next: NotifyLevel) => {
      const current = notifyLevel
      setNotifyLevel(next)
      const res = await setChannelNotifyLevel({ channelId: channel.id, level: next })
      if (!res.ok) {
        setNotifyLevel(current)
        setError(res.error)
      }
    },
    [notifyLevel, channel.id]
  )

  quickActionsRef.current = { flipStar, changeNotifyLevel, openPins }

  // ── ↑ 편집 ───────────────────────────────────────────────────────────────
  const onEditLast = useCallback(() => {
    const m = lastEditableMessage(messagesRef.current, me.id)
    if (m) setEditingId(m.id)
  }, [me.id])

  const join = () =>
    startJoin(async () => {
      const res = await joinChannel({ channelId: channel.id })
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })

  const label = isDm
    ? `${channel.name}님과의 대화`
    : isGroup
      ? `${channel.name} 그룹 대화`
      : `#${channel.name} 메시지`
  const composerLabel = isDm
    ? `${channel.name}님에게 메시지 보내기`
    : isGroup
      ? `${channel.name}에 메시지 보내기`
      : `#${channel.name}에 메시지 보내기`
  const peerOnline = peerId ? topic.online.includes(peerId) : false
  // ggac 이식(폴링): 접속 목록은 워크스페이스 전체라(02-sync.md §6) 이 대화의 멤버로 좁혀 센다
  const memberIds = useMemo(() => new Set(members.map(m => m.user_id)), [members])
  const onlineMembers = topic.online.filter(id => memberIds.has(id)).length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChannelHeader
        channel={channel}
        memberCount={members.length}
        onlineCount={onlineMembers}
        peerOnline={peerOnline}
        isMember={isMember}
        starred={starred}
        notifyLevel={notifyLevel}
        onToggleStar={() => void flipStar()}
        onChangeNotifyLevel={level => void changeNotifyLevel(level)}
        onOpenInfo={openInfo}
        onOpenPins={openPins}
        pinCount={pinned.size}
      />
      <ConversationTabBar conversation={channel} activeKey="posts" data={tabBar} />
      {isMember && <ConnectionBadge status={topic.status} online={networkOnline} />}

      <MessageList
        label={label}
        messages={state.messages}
        hasMore={state.hasMore}
        loadingOlder={loadingOlder}
        onLoadOlder={() => void loadOlder()}
        lastReadAt={lastReadAt}
        me={me.id}
        nameOf={nameOf}
        statusOf={statusOf}
        members={mentionMembers}
        editingId={editingId}
        pinnedIds={pinned}
        bookmarkedIds={bookmarks}
        canModerate={me.isAdmin}
        readOnly={!canWrite}
        filesBase={conversationBasePath(channel)}
        onReachBottom={markRead}
        onReact={canWrite ? ops.react : undefined}
        onOpenThread={openThread}
        onStartEdit={canWrite ? m => setEditingId(m.id) : undefined}
        onCancelEdit={() => setEditingId(null)}
        onSaveEdit={ops.edit}
        onDelete={onDeleteMessage}
        onTogglePin={canWrite ? onTogglePin : undefined}
        onToggleBookmark={onToggleBookmark}
        onRetry={m =>
          void ops.send({
            channelId: channel.id,
            body: m.body,
            retryId: m.id,
            quotedMessageId: m.quoted_message_id,
          })
        }
        onQuote={canPostHere ? onQuote : undefined}
        onForward={fwd.forward}
        empty={
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <MessagesSquareIcon aria-hidden="true" className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {isDm
                ? `${channel.name}님과 대화를 시작해 보세요.`
                : isGroup
                  ? `${channel.name} 그룹 대화를 시작해 보세요.`
                  : archived
                    ? '보관된 채널입니다. 남은 메시지가 없습니다.'
                    : `#${channel.name} 채널의 첫 메시지를 남겨 보세요.`}
            </p>
            {!isDm && !isGroup && channel.topic && (
              <p className="max-w-sm text-xs text-muted-foreground">{channel.topic}</p>
            )}
          </div>
        }
      />

      {error && (
        <p
          role="alert"
          className="mx-4 mb-1 rounded-w-lg bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      {syncNotice && (
        <p
          role="alert"
          className="mx-4 mb-1 flex flex-wrap items-center gap-2 rounded-w-lg bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
        >
          {syncNotice === 'stale'
            ? '새 버전이 배포되었습니다. 새로 고침하면 최신 화면으로 바뀝니다.'
            : '실시간 갱신이 끊겼습니다. 새로 고침하면 최신 메시지를 볼 수 있습니다.'}
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => window.location.reload()}
          >
            새로 고침
          </button>
        </p>
      )}

      {catchUpNotice && (
        <p
          role="status"
          className="mx-4 mb-1 rounded-w-lg bg-subtle px-3 py-1.5 text-xs text-muted-foreground"
        >
          새 메시지가 많아 최근 것부터 보여 줍니다. 위로 올리면 이전 메시지를 불러옵니다.
        </p>
      )}

      {fwd.notice}
      {fwd.dialog}

      {announcementOnly ? (
        <p role="note" className="border-t px-4 py-4 text-center text-sm text-muted-foreground">
          {POST_RESTRICTED_NOTICE}. 답글은 메시지의 스레드에서 달 수 있습니다.
        </p>
      ) : canWrite ? (
        <>
          <TypingIndicator users={topic.typing} />
          <AttachmentPicker uploads={attachments.uploads}>
            <MessageComposer
              label={composerLabel}
              placeholder={composerLabel}
              mentionCandidates={mentionCandidates}
              allowChannelMention={!isDm}
              onSubmit={({ body, attachmentIds }) => {
                const quoted = quote
                setQuote(null)
                return ops.send({
                  channelId: channel.id,
                  body,
                  attachmentIds,
                  quotedMessageId: quoted?.id,
                })
              }}
              draftKey={draftKey(me.id, channel.id)}
              focusSignal={focusSignal}
              quoteSlot={
                quote ? (
                  <QuotePreview
                    authorName={nameOf(quote.authorId)}
                    body={quote.body}
                    onCancel={() => setQuote(null)}
                  />
                ) : undefined
              }
              onSent={attachments.onSent}
              onEditLast={onEditLast}
              onTyping={topic.sendTyping}
              onAttach={attachments.onAttach}
              onCreateDocument={createDoc.available ? () => createDoc.open(null) : undefined}
              attachmentsSlot={attachments.attachmentsSlot}
              pendingAttachmentIds={attachments.pendingAttachmentIds}
              sendBlocked={attachments.sendBlocked}
              onFiles={attachments.onFiles}
            />
          </AttachmentPicker>
          {createDoc.dialog}
        </>
      ) : archived ? (
        <p className="border-t px-4 py-4 text-center text-sm text-muted-foreground">
          보관된 채널입니다. 메시지를 읽을 수만 있습니다.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-2 border-t px-4 py-4 text-center sm:flex-row sm:justify-center">
          <p className="text-sm text-muted-foreground">
            #{channel.name} 채널을 미리 보고 있습니다.
          </p>
          <Button type="button" size="sm" onClick={join} disabled={joining}>
            채널 참여하기
          </Button>
        </div>
      )}
    </div>
  )
}
