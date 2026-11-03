'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname } from '@/i18n/navigation'
import { isBoardWorkEditPath, isBoardWorkPath } from '@/lib/boardWork/paths'
import {
  boardWorkMenuBadges,
  conversationsFromSnapshot,
  type MenuBadge,
  type MenuBadgeInput,
  type MenuBadgeKey,
} from '@/lib/boardWork/menuBadges'
import { subscribeBadges } from '@work/lib/messages/realtime'
import type { SidebarBadgeSnapshot } from '@work/lib/channels/badge-snapshot'
import { getWorkMenuSummary, type WorkMenuSummary } from '@work/lib/channels/menu-actions'

/** 폴링 응답 하나의 배지 스냅숏과 그 조회를 시작한 시각(ms) */
export type BoardWorkBadgeLive = { snapshot: SidebarBadgeSnapshot; requestedAt: number }

type BoardWorkBadgesValue = {
  /** 이사·감사·관리자라 폴러를 켰는가 */
  enabled: boolean
  /** 가장 최근 폴링 응답의 배지(셸 목록 배지도 이 값을 받는다 — SidebarLiveUpdates) */
  live: BoardWorkBadgeLive | null
  /** 메뉴 '업무' 묶음 배지 */
  badges: Partial<Record<MenuBadgeKey, MenuBadge>>
  /**
   * 업무 화면 셸(WorkShell)이 자기 목록(스냅숏 + 읽음 보정이 얹힌 값)으로 계산한 재료를 올린다. 셸이 있는 동안 메뉴는
   * 그 값을 쓴다 — 채널을 읽자마자 메뉴 배지도 같이 줄어든다. 셸이 사라지면 null을 올린다.
   */
  setShellInput: (input: MenuBadgeInput | null) => void
}

const NO_BADGES: Partial<Record<MenuBadgeKey, MenuBadge>> = {}

const BoardWorkBadgesContext = createContext<BoardWorkBadgesValue | null>(null)

/**
 * 이사회 업무 배지의 원천(docs/board-work/03-통합-재설계.md §4-3). 이사회실 레이아웃이 감싼다.
 *
 * - `enabled`(이사·감사·관리자 판정이 끝났을 때만 true)일 때만 폴러에 배지 구독을 건다 — 조합원은 sync가 403이라
 *   아예 부르지 않는다.
 * - 폴러는 탭당 하나(`realtime.ts`)라 주기는 거기서 정해진다: 업무 화면 밖(배지만)은 10초, 채널·스레드를 보는 중이면 3초,
 *   탭이 숨으면 멈춘다(02-sync.md §5). 여기서 주기를 따로 두지 않는다.
 * - 업무 화면 밖에서는 대화 종류·뮤트를 `getWorkMenuSummary`로 읽는다(경로가 바뀔 때, 그리고 폴링이 내 대화 목록
 *   변경(`membershipChanged` — 새 DM·채널 초대)을 알릴 때 한 번씩). 열린 할 일 수는 폴링 응답의 `badges.openTaskCount`.
 *   업무 화면 안에서는 셸이 올린 값(`setShellInput`)을 쓴다.
 */
export function BoardWorkBadgesProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname() || ''
  const [live, setLive] = useState<BoardWorkBadgeLive | null>(null)
  const [summary, setSummary] = useState<WorkMenuSummary | null>(null)
  const [shellInput, setShellInputState] = useState<MenuBadgeInput | null>(null)
  // 내 대화 목록이 바뀐 횟수(폴링의 membershipChanged) — 바뀌면 요약(대화 종류·뮤트)을 다시 읽는다
  const [membershipTick, setMembershipTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let lastJson = ''
    return subscribeBadges((snapshot, requestedAt, membershipChanged) => {
      // 새 DM·채널 초대: 요약에 아직 없는 대화는 "뮤트 아닌 채널"로 보여(점) DM인데도 숫자 배지가 안 뜬다
      if (membershipChanged) setMembershipTick(t => t + 1)
      // 폴마다 레이아웃 전체를 다시 그리지 않게 — 숫자가 그대로면 넘긴다
      const json = JSON.stringify(snapshot)
      if (json === lastJson) return
      lastJson = json
      setLive({ snapshot, requestedAt })
    })
  }, [enabled])

  // 셸이 없는 화면(업무 밖·편집 화면)에서만 요약을 읽는다. 경로가 바뀔 때와 내 대화 목록이 바뀔 때(새 DM 등) 한 번씩.
  // 열린 할 일 수는 폴링 응답(`badges.openTaskCount`)이 주기마다 맞춘다 — 요약 값은 첫 응답 전까지만 쓴다.
  const needsSummary = enabled && (!isBoardWorkPath(pathname) || isBoardWorkEditPath(pathname))
  useEffect(() => {
    if (!needsSummary) return
    let cancelled = false
    getWorkMenuSummary()
      .then(res => {
        if (!cancelled && res.ok) setSummary(res.data)
      })
      .catch(() => {
        // 곁가지다 — 실패하면 직전 값(또는 없음)으로 둔다. 안 읽음·멘션은 폴링 응답이 계속 준다
      })
    return () => {
      cancelled = true
    }
  }, [needsSummary, pathname, membershipTick])

  const setShellInput = useCallback((input: MenuBadgeInput | null) => {
    setShellInputState(input)
  }, [])

  const badges = useMemo(() => {
    if (!enabled) return NO_BADGES
    if (shellInput) return boardWorkMenuBadges(shellInput)
    if (!live && !summary) return NO_BADGES
    return boardWorkMenuBadges({
      conversations: live
        ? conversationsFromSnapshot(live.snapshot.channels, summary?.conversations)
        : [],
      mentionCount: live?.snapshot.mentionCount ?? 0,
      activityCount: live?.snapshot.activityCount ?? 0,
      openTaskCount: live?.snapshot.openTaskCount ?? summary?.openTaskCount ?? 0,
    })
  }, [enabled, shellInput, live, summary])

  const value = useMemo<BoardWorkBadgesValue>(
    () => ({ enabled, live: enabled ? live : null, badges, setShellInput }),
    [enabled, live, badges, setShellInput]
  )

  return <BoardWorkBadgesContext.Provider value={value}>{children}</BoardWorkBadgesContext.Provider>
}

/** 이사회실 레이아웃 밖(테스트·단독 렌더)에서는 null */
export function useBoardWorkBadges(): BoardWorkBadgesValue | null {
  return useContext(BoardWorkBadgesContext)
}
