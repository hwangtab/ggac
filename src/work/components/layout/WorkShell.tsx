'use client'

import ServiceWorkerRegistrar from '@work/components/push/ServiceWorkerRegistrar'
import { resumeDraftWrites } from '@work/lib/messages/drafts'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from '@work/lib/nav/navigation'
import { cn } from '@work/lib/utils'
import { useBoardWorkBadges } from '@/components/boardWork/BoardWorkBadges'
import type { ActiveStatus } from '@work/lib/notifications/status'
import { setChannelStarred } from '@work/lib/channels/actions'
import {
  createCategory,
  deleteCategory,
  moveChannelToCategory,
  renameCategory,
  reorderCategories,
} from '@work/lib/channels/category-actions'
import { applyCategoryOrder, type ChannelCategory } from '@work/lib/channels/sections'
import { setChannelSort, setChatSort } from '@work/lib/channels/sort-actions'
import {
  bumpActivity,
  sortChats,
  DEFAULT_CHANNEL_SORT,
  DEFAULT_CHAT_SORT,
  type ChannelSort,
  type ChatSort,
} from '@work/lib/channels/sort'
import ListPane from './ListPane'
import QuickSwitcher, { type QuickSwitcherPerson, type QuickSwitcherWikiDoc } from './QuickSwitcher'
import { RightPanelProvider, RightPanelSlot, useRightPanel } from './RightPanel'
import {
  ShellDataProvider,
  type CategoryOps,
  type ExpenseShellData,
  type ShellPerson,
} from './shell-context'
import { unreadTitleCount } from './nav-sections'
import {
  WORK_PANE_HEIGHT_CLASS,
  hasWorkListPane,
  mobileBackLink,
  mobileShowsList,
  workSection,
} from './work-layout'
import Link from '@work/lib/nav/link'
import { ArrowLeftIcon } from 'lucide-work'
import { useUnreadIndicators } from './use-unread-indicators'
import { useWorkspacePresence } from './use-workspace-presence'
import { withPresence } from './presence'
import type { ChannelListItem } from './channel-items'
import { applyBadgeSnapshot, type SidebarBadgeSnapshot } from '@work/lib/channels/badge-snapshot'
import {
  SidebarBadgesProvider,
  applyLocalMentionCount,
  applyLocalReads,
  effectiveReads,
  type ReadRecord,
  type SidebarBadgesApi,
} from './sidebar-badges'

export type ShellMe = {
  displayName: string
  title: string | null
  /** 내 상태 메시지(0027) */
  status?: ActiveStatus | null
}

type ShellProps = {
  me: ShellMe
  channels: ChannelListItem[]
  /** 채널 목록 정렬 방식(0030, 서버가 staff_prefs 에서 읽은 값) */
  channelSort?: ChannelSort
  /** 채팅(DM·그룹) 목록 정렬 방식(0031) */
  chatSort?: ChatSort
  dms: ChannelListItem[]
  /** 채널 카테고리(0044, 서버가 position 순으로) */
  categories?: ChannelCategory[]
  isAdmin: boolean
  /** 게스트: 위키·자료실·채널 만들기 링크를 숨긴다 */
  isGuest?: boolean
  wikiDocs?: QuickSwitcherWikiDoc[]
  /** 내 미완료 할 일 수(이사회실 메뉴 "할 일" 배지) */
  openTaskCount?: number
  /** 지출결의(0045): 내 결재 역할과 대기 수(목록 패널). 서브관리자는 없다 */
  expense?: ExpenseShellData
  /** 읽지 않은 멘션 수(이사회실 메뉴 "활동" 배지) */
  mentionCount?: number
  /** 내 user_id — 있으면(게스트 제외) 접속 표시(presence, 0020)에 접속하고 DM 접속 점을 그린다 */
  meId?: string
  /** 1:1 DM 채널 id → 상대 user_id(listDmPeers). 접속 점 매핑용 */
  dmPeers?: Record<string, string>
  /** 새 스레드 답글·반응 수(멘션과 합산해 "활동" 배지·탭 제목에 쓴다) */
  activityCount?: number
  /** ⌘K "사람"(DM 열기)·채널 만들기 멤버 후보 */
  people?: (QuickSwitcherPerson & Pick<ShellPerson, 'role'>)[]
  children: ReactNode
}

const NO_READ_RECORDS: ReadonlyMap<string, ReadRecord> = new Map()
const NO_PINS: ReadonlyMap<string, boolean> = new Map()
const NO_BUMPS: ReadonlyMap<string, number> = new Map()
const NO_MOVES: ReadonlyMap<string, string | null> = new Map()
const NO_CATEGORIES: ChannelCategory[] = []

/** 순수: 낙관적으로 바꾼 고정 상태를 덮어쓴다 */
function applyPins(
  items: ChannelListItem[],
  pins: ReadonlyMap<string, boolean>
): ChannelListItem[] {
  if (pins.size === 0) return items
  return items.map(i => (pins.has(i.id) ? { ...i, starred: pins.get(i.id) ?? i.starred } : i))
}

/** 순수: 낙관적으로 옮긴 카테고리를 덮어쓴다 */
function applyMoves(
  items: ChannelListItem[],
  moves: ReadonlyMap<string, string | null>
): ChannelListItem[] {
  if (moves.size === 0) return items
  return items.map(i => (moves.has(i.id) ? { ...i, categoryId: moves.get(i.id) ?? null } : i))
}

/**
 * 업무 화면 셸 — 원본 `AppShell`을 쪼갠 것(docs/board-work/03-통합-재설계.md §3·§4-2). 이사회실 콘텐츠 칸 안에서
 * 목록 칸(w-72) │ 대화 칸 │ 패널(2xl부터 세 번째 칸, 그보다 좁으면 대화 칸을 덮는다)을 그린다.
 * 원본의 레일·상단바·하단 탭·테마 전환은 없다 — 길찾기는 이사회실 메뉴 '업무' 묶음, 로그아웃은 ggac 전역 내비가 맡는다.
 * 좁은 화면(lg 미만): 메일함과 같은 목록 → 상세 전환(`← 목록`), 패널은 대화 칸 전체를 덮는다(`← 대화`).
 * 키보드: ⌘K(Ctrl+K) 빠른 이동, Esc 우측 패널 닫기(RightPanelProvider).
 * 안 읽음 수는 탭 제목 `(N) …`과 PWA 앱 배지로도 알린다(use-unread-indicators). 이사회실 메뉴 배지에는 같은 값을 올린다.
 */
export default function WorkShell(props: ShellProps) {
  return (
    <RightPanelProvider>
      <ShellFrame {...props} />
    </RightPanelProvider>
  )
}

function ShellFrame({
  me,
  channels: serverChannels,
  channelSort: serverChannelSort = DEFAULT_CHANNEL_SORT,
  chatSort: serverChatSort = DEFAULT_CHAT_SORT,
  dms: serverDms,
  categories: serverCategories = NO_CATEGORIES,
  isAdmin,
  isGuest = false,
  wikiDocs,
  openTaskCount = 0,
  expense: serverExpense,
  mentionCount: serverMentionCount = 0,
  activityCount: serverActivityCount = 0,
  meId,
  dmPeers,
  people,
  children,
}: ShellProps) {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const newChat = searchParams?.get('new') === '1'
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const panel = useRightPanel()
  // ⌘K "사람" 맨 앞에 나(나와의 채팅). 채널 만들기 멤버 후보(ShellData.people)에는 넣지 않는다
  const switcherPeople = useMemo(
    () =>
      people && meId
        ? [{ userId: meId, name: `${me.displayName} (나)`, title: me.title }, ...people]
        : people,
    [people, meId, me.displayName, me.title]
  )

  // 서버 props → (실시간 배지 스냅샷으로 덮은) 기준값 → (읽음 처리로 지운) 로컬 보정 순으로 쌓는다(sidebar-badges.ts).
  // 서버가 새 셸 데이터를 보내면(props 가 바뀌면) 스냅샷·보정은 버린다.
  const serverSource = useMemo(
    () => ({
      serverChannels,
      serverDms,
      serverMentionCount,
      serverActivityCount,
      serverExpenseCounts: serverExpense?.counts,
      serverCategories,
    }),
    [
      serverChannels,
      serverDms,
      serverMentionCount,
      serverActivityCount,
      serverExpense?.counts,
      serverCategories,
    ]
  )
  const [live, setLive] = useState<{
    source: typeof serverSource
    snapshot: SidebarBadgeSnapshot
    /** 스냅샷 조회를 시작한 시각(ms) — 읽음 기록과 비교해 어느 쪽이 더 새것인지 판단한다 */
    at: number
  } | null>(null)
  const base = useMemo(() => {
    if (!live || live.source !== serverSource) {
      return { ...serverSource, key: serverSource as object }
    }
    const { snapshot } = live
    return {
      serverChannels: applyBadgeSnapshot(serverChannels, snapshot),
      serverDms: applyBadgeSnapshot(serverDms, snapshot),
      serverMentionCount: snapshot.mentionCount,
      serverActivityCount: snapshot.activityCount,
      serverExpenseCounts: snapshot.expense ?? serverExpense?.counts,
      key: live as object,
    }
  }, [live, serverSource, serverChannels, serverDms, serverExpense?.counts])
  // 읽음 기록은 스냅샷이 바뀌어도(base.key) 버리지 않는다 — 읽음 응답이 스냅샷 적용과 엇갈려 늦게 와도 잃지 않게
  // "이 채널은 시각 T 에 읽음"으로 서버 데이터(serverSource) 단위로 둔다. 스냅샷 조회 시작 이후의 읽음만 얹는다.
  const [localReads, setLocalReads] = useState<{
    source: object
    records: ReadonlyMap<string, ReadRecord>
  }>({ source: serverSource, records: NO_READ_RECORDS })
  const readRecords = localReads.source === serverSource ? localReads.records : NO_READ_RECORDS
  const snapshotAt = live && live.source === serverSource ? live.at : null
  const reads = useMemo(() => effectiveReads(readRecords, snapshotAt), [readRecords, snapshotAt])
  const badgesApiBase = useMemo<Omit<SidebarBadgesApi, 'bumpActivity'>>(
    () => ({
      markRead: (channelId, clearedMentions) =>
        setLocalReads(prev => {
          const cur = prev.source === serverSource ? prev.records : NO_READ_RECORDS
          const next = new Map(cur)
          next.set(channelId, {
            cleared: (cur.get(channelId)?.cleared ?? 0) + Math.max(0, clearedMentions),
            at: Date.now(),
          })
          return { source: serverSource, records: next }
        }),
      applySnapshot: (snapshot, requestedAt) =>
        setLive({ source: serverSource, snapshot, at: requestedAt ?? Date.now() }),
    }),
    [serverSource]
  )
  // 고정(핀) 낙관적 갱신 · 실시간 최근 활동 시각 — 서버가 새 셸 데이터를 보내오면(props 변경) 둘 다 버린다
  const [pinState, setPinState] = useState<{ source: object; pins: ReadonlyMap<string, boolean> }>({
    source: serverSource,
    pins: NO_PINS,
  })
  const pins = pinState.source === serverSource ? pinState.pins : NO_PINS
  const [bumpState, setBumpState] = useState<{
    source: object
    bumps: ReadonlyMap<string, number>
  }>({ source: serverSource, bumps: NO_BUMPS })
  const bumps = bumpState.source === serverSource ? bumpState.bumps : NO_BUMPS
  // 카테고리 낙관적 갱신(채널 이동·순서·이름·삭제) — 서버가 새 셸 데이터를 보내오면 버린다
  const [moveState, setMoveState] = useState<{
    source: object
    moves: ReadonlyMap<string, string | null>
  }>({ source: serverSource, moves: NO_MOVES })
  const moves = moveState.source === serverSource ? moveState.moves : NO_MOVES
  const [categoryState, setCategoryState] = useState<{
    source: object
    list: ChannelCategory[] | null
  }>({ source: serverSource, list: null })
  const categories =
    categoryState.source === serverSource && categoryState.list
      ? categoryState.list
      : serverCategories
  const [channelSort, setChannelSortState] = useState<ChannelSort>(serverChannelSort)
  const [chatSort, setChatSortState] = useState<ChatSort>(serverChatSort)
  const [shellNotice, setShellNotice] = useState<string | null>(null)

  const badgesApi = useMemo<SidebarBadgesApi>(
    () => ({
      ...badgesApiBase,
      bumpActivity: (channelId, at) =>
        setBumpState(prev => {
          const cur = prev.source === serverSource ? prev.bumps : NO_BUMPS
          if ((cur.get(channelId) ?? 0) >= at) return prev
          const next = new Map(cur)
          next.set(channelId, at)
          return { source: serverSource, bumps: next }
        }),
    }),
    [badgesApiBase, serverSource]
  )

  // 채널별 고정 요청 순번·서버가 확인한 값. 연타하면 요청이 겹치므로 **마지막 요청의 결과만** 화면에 반영하고,
  // 실패하면 직전 낙관적 값이 아니라 서버가 마지막으로 확인한 값으로 되돌린다(더 새 낙관적 값은 지우지 않는다).
  // 서버 액션은 한 클라이언트에서 순서대로 처리되므로 응답 순서 = 요청 순서다.
  const pinRequests = useRef(
    new Map<string, { seq: number; pending: number; confirmed: boolean }>()
  )
  const togglePin = useCallback(
    (item: ChannelListItem, next: boolean) => {
      const setPin = (value: boolean) =>
        setPinState(prev => {
          const cur = prev.source === serverSource ? prev.pins : NO_PINS
          const map = new Map(cur)
          map.set(item.id, value)
          return { source: serverSource, pins: map }
        })
      const requests = pinRequests.current
      // 처음 요청이면 클릭 시점의 값(= !next)이 서버가 확인한 값이다
      const state = requests.get(item.id) ?? { seq: 0, pending: 0, confirmed: !next }
      state.seq += 1
      state.pending += 1
      requests.set(item.id, state)
      const mySeq = state.seq
      const settle = (ok: boolean, message?: string) => {
        state.pending -= 1
        if (ok) state.confirmed = next
        else if (mySeq === state.seq) {
          // 마지막 요청이 실패 — 서버가 아는 값으로 되돌린다. 앞선 요청의 늦은 실패는 무시한다.
          setPin(state.confirmed)
          setShellNotice(message ?? '고정을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
        }
        if (state.pending === 0) requests.delete(item.id)
      }
      setPin(next)
      setChannelStarred({ channelId: item.id, value: next })
        .then(res => (res.ok ? settle(true) : settle(false, res.error)))
        .catch(() => settle(false))
    },
    [serverSource]
  )

  const changeChannelSort = useCallback(
    (next: ChannelSort) => {
      const prev = channelSort
      setChannelSortState(next)
      const revert = (message: string) => {
        setChannelSortState(prev)
        setShellNotice(message)
      }
      setChannelSort({ sort: next })
        .then(res => {
          if (!res.ok) revert(res.error)
        })
        .catch(() => revert('정렬 방식을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
    },
    [channelSort]
  )

  const changeChatSort = useCallback(
    (next: ChatSort) => {
      const prev = chatSort
      setChatSortState(next)
      const revert = (message: string) => {
        setChatSortState(prev)
        setShellNotice(message)
      }
      setChatSort({ sort: next })
        .then(res => {
          if (!res.ok) revert(res.error)
        })
        .catch(() => revert('정렬 방식을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
    },
    [chatSort]
  )

  // 카테고리 조작 — 이동·순서는 낙관적으로 먼저 바꾸고 실패하면 이전 값으로 되돌린다. 요청이 겹치면 마지막 결과만 반영한다.
  const moveSeq = useRef(new Map<string, number>())
  const categoriesRef = useRef(categories)
  categoriesRef.current = categories
  const categoryOps = useMemo<CategoryOps>(() => {
    const setMove = (id: string, value: string | null | undefined) =>
      setMoveState(prev => {
        const cur = prev.source === serverSource ? prev.moves : NO_MOVES
        const map = new Map(cur)
        if (value === undefined) map.delete(id)
        else map.set(id, value)
        return { source: serverSource, moves: map }
      })
    const setList = (list: ChannelCategory[] | null) =>
      setCategoryState({ source: serverSource, list })
    return {
      moveChannel: (item, categoryId) => {
        const before = item.categoryId ?? null
        if (before === categoryId) return
        const mySeq = (moveSeq.current.get(item.id) ?? 0) + 1
        moveSeq.current.set(item.id, mySeq)
        setMove(item.id, categoryId)
        moveChannelToCategory({ channelId: item.id, categoryId })
          .then(res => {
            if (res.ok) return
            if (mySeq === moveSeq.current.get(item.id)) setMove(item.id, before)
            setShellNotice(res.error)
          })
          .catch(() => {
            setMove(item.id, before)
            setShellNotice('채널을 옮기지 못했습니다. 잠시 후 다시 시도해 주세요.')
          })
      },
      createCategory: async name => {
        try {
          const res = await createCategory({ name })
          return res.ok ? { ok: true, id: res.data.id } : { ok: false, error: res.error }
        } catch {
          return { ok: false, error: '카테고리를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }
        }
      },
      renameCategory: async (id, name) => {
        try {
          const res = await renameCategory({ categoryId: id, name })
          if (res.ok) {
            setList(categoriesRef.current.map(c => (c.id === id ? { ...c, name } : c)))
            return { ok: true }
          }
          return { ok: false, error: res.error }
        } catch {
          return { ok: false, error: '이름을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.' }
        }
      },
      reorderCategories: ids => {
        const before = categoriesRef.current
        setList(applyCategoryOrder(before, ids))
        reorderCategories({ ids })
          .then(res => {
            if (res.ok) return
            setList(before)
            setShellNotice(res.error)
          })
          .catch(() => {
            setList(before)
            setShellNotice('순서를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
          })
      },
      deleteCategory: async id => {
        try {
          const res = await deleteCategory({ categoryId: id })
          if (res.ok) {
            setList(categoriesRef.current.filter(c => c.id !== id))
            return { ok: true }
          }
          return { ok: false, error: res.error }
        } catch {
          return { ok: false, error: '카테고리를 지우지 못했습니다. 잠시 후 다시 시도해 주세요.' }
        }
      },
    }
  }, [serverSource])

  useEffect(() => {
    if (!shellNotice) return
    const t = setTimeout(() => setShellNotice(null), 6000)
    return () => clearTimeout(t)
  }, [shellNotice])

  // 아래(목록 칸·⌘K·탭 제목·이사회실 메뉴 배지)는 모두 이 값을 쓴다
  const channels = useMemo(
    () =>
      bumpActivity(
        applyMoves(applyPins(applyLocalReads(base.serverChannels, reads), pins), moves),
        bumps
      ),
    [base.serverChannels, reads, pins, moves, bumps]
  )
  const activityCount = base.serverActivityCount
  const expenseCounts = base.serverExpenseCounts
  // 업무툴 전체 접속 표시(presence, 0020): 내부 staff 만 구독한다(게스트는 DB 인가도 거절)
  const online = useWorkspacePresence(
    meId && !isGuest ? { userId: meId, displayName: me.displayName } : null
  )
  const dms = useMemo(
    () =>
      withPresence(
        sortChats(
          bumpActivity(applyPins(applyLocalReads(base.serverDms, reads), pins), bumps),
          chatSort
        ),
        dmPeers,
        online
      ),
    [base.serverDms, reads, pins, bumps, chatSort, dmPeers, online]
  )
  const mentionCount = applyLocalMentionCount(base.serverMentionCount, reads)

  // 로그아웃 정리가 멈춘 임시 저장 쓰기를 다음 로그인 셸이 열릴 때 재개한다
  useEffect(() => {
    resumeDraftWrites()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 한글 입력 상태에서도 동작하도록 물리 키(e.code)도 본다(e.key 가 'ㅏ' 로 올 수 있다)
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault()
        setSwitcherOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = useMemo(() => [...channels, ...dms], [channels, dms])
  useUnreadIndicators(unreadTitleCount({ dms, mentionCount, activityCount }))

  // 이사회실 메뉴 배지(03 §4-3)에 이 셸의 값(스냅숏 + 읽음 보정)을 올린다 — 채널을 읽으면 메뉴 배지도 바로 준다
  const setMenuInput = useBoardWorkBadges()?.setShellInput
  useEffect(() => {
    setMenuInput?.({
      conversations: [
        ...channels.map(c => ({ unread: c.unread, mentions: c.mentions, muted: c.muted })),
        ...dms.map(d => ({ unread: d.unread, mentions: d.mentions, muted: d.muted, dm: true })),
      ],
      mentionCount,
      activityCount,
      openTaskCount,
    })
  }, [setMenuInput, channels, dms, mentionCount, activityCount, openTaskCount])
  useEffect(() => () => setMenuInput?.(null), [setMenuInput])
  const shellData = useMemo(
    () => ({
      channels,
      dms,
      isGuest,
      meId,
      channelSort,
      onChannelSortChange: changeChannelSort,
      chatSort,
      onChatSortChange: changeChatSort,
      onTogglePin: togglePin,
      expense: serverExpense
        ? { ...serverExpense, counts: expenseCounts ?? serverExpense.counts }
        : undefined,
      categories,
      isAdmin,
      categoryOps: isAdmin && !isGuest ? categoryOps : undefined,
      people: isGuest ? undefined : people,
    }),
    [
      channels,
      dms,
      categories,
      isAdmin,
      categoryOps,
      people,
      isGuest,
      meId,
      channelSort,
      changeChannelSort,
      chatSort,
      changeChatSort,
      togglePin,
      serverExpense,
      expenseCounts,
    ]
  )
  const section = workSection(pathname)
  const listOnMobile = mobileShowsList(pathname, { newChat })
  const back = mobileBackLink(pathname, { newChat })

  return (
    <SidebarBadgesProvider value={badgesApi}>
      <ShellDataProvider value={shellData}>
        <div data-work-app className={cn('flex gap-3 lg:gap-4', WORK_PANE_HEIGHT_CLASS)}>
          <ServiceWorkerRegistrar userId={meId ?? null} />
          {hasWorkListPane(section) && (
            <ListPane
              channels={channels}
              dms={dms}
              isGuest={isGuest}
              mentionCount={mentionCount}
              activityCount={activityCount}
              onMobile={listOnMobile}
            />
          )}
          {/* 대화 칸 — 좁은 화면에서 목록이 화면을 차지하면(대화 첫 화면) 숨긴다 */}
          <div
            className={cn(
              'relative min-w-0 flex-1 flex-col overflow-hidden rounded-w-lg border bg-background',
              listOnMobile ? 'hidden lg:flex' : 'flex'
            )}
          >
            {/* 패널(스레드 등)이 칸을 덮으면 패널 머리의 `← 대화`만 남긴다 — 뒤로 가기가 두 줄로 겹치지 않게 */}
            {back && !panel.isOpen && (
              <div className="flex h-10 shrink-0 items-center border-b px-2 lg:hidden">
                <Link
                  href={back.href}
                  className="inline-flex items-center gap-1 rounded-w-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeftIcon aria-hidden="true" className="size-4" />
                  {back.label}
                </Link>
              </div>
            )}
            <div className="relative flex min-h-0 flex-1">
              <div id="work-main" className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {children}
              </div>
              <RightPanelSlot />
            </div>
          </div>
        </div>
        {shellNotice && (
          <div
            role="alert"
            className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-w-lg bg-popover px-4 py-2 text-sm text-destructive shadow-md ring-1 ring-foreground/10"
          >
            {shellNotice}
          </div>
        )}
        <QuickSwitcher
          open={switcherOpen}
          onOpenChange={setSwitcherOpen}
          items={items}
          wikiDocs={wikiDocs}
          people={switcherPeople}
        />
      </ShellDataProvider>
    </SidebarBadgesProvider>
  )
}
