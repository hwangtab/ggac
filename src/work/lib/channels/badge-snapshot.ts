import type { ChannelListItem } from '@work/components/layout/channel-items'

/**
 * 사이드바 배지만 담은 가벼운 스냅샷(서버 액션 getSidebarBadges 의 결과).
 * 레이아웃 전체(router.refresh)를 다시 그리지 않고 안 읽은 수·멘션 수·활동 수만 새로 맞출 때 쓴다.
 * 순수 모듈 — 'use server' 파일은 async 함수만 export 할 수 있어 타입·함수를 따로 둔다.
 */
export type SidebarBadgeSnapshot = {
  /** 채널 id → 안 읽은 수·멘션 수 (없으면 0) */
  channels: Record<string, { unread: number; mentions: number }>
  /** 읽지 않은 멘션 수("활동" 배지) */
  mentionCount: number
  /** 새 스레드 답글·반응 수 */
  activityCount: number
  /**
   * 내 열린 할 일 수(이사회실 메뉴 '할 일' 배지 — ggac에서 더한 값). 폴링 응답(`/api/board-room/work/sync`)만 싣는다 —
   * 서버 액션 `getSidebarBadges`는 싣지 않아 없을 수 있다. 읽기 범위 안의 채널만 센다(countMyOpenTaskRecords)
   */
  openTaskCount?: number
  /** 결재 배지(0045). 서브관리자는 없다 */
  expense?: { approvalPending: number; paymentPending: number; myUnseen: number }
}

/** 순수: 목록의 안 읽은 수·멘션 수를 스냅샷 값으로 바꾼다(스냅샷에 없는 채널은 0). 바뀐 게 없으면 같은 배열을 돌려준다. */
export function applyBadgeSnapshot(
  items: ChannelListItem[],
  snapshot: SidebarBadgeSnapshot
): ChannelListItem[] {
  let changed = false
  const next = items.map(item => {
    const c = snapshot.channels[item.id]
    const unread = c?.unread ?? 0
    const mentions = c?.mentions ?? 0
    if (item.unread === unread && (item.mentions ?? 0) === mentions) return item
    changed = true
    return { ...item, unread, mentions }
  })
  return changed ? next : items
}
