'use server'

import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import type { MenuConversationMeta } from '@/lib/boardWork/menuBadges'
import { countMyOpenTasks } from '@work/lib/tasks/queries'
import { dbFailure, ok, type ActionResult } from './action-result'
import { listSidebarChannels } from './queries'

export type WorkMenuSummary = {
  /** 내가 멤버인 대화(채널·DM·그룹)의 종류·뮤트 — 폴링 배지 스냅숏을 메뉴 배지로 바꿀 때 쓴다 */
  conversations: MenuConversationMeta
  /** 내 열린 할 일 수(메뉴 '할 일' 배지) */
  openTaskCount: number
}

/**
 * 이사회실 메뉴 '업무' 묶음 배지의 재료(ggac에서 더한 액션 — docs/board-work/03-통합-재설계.md §4-3).
 * 업무 화면 **밖**(회의·서류함 …)에서 이사회실 레이아웃이 부른다. 안 읽은 수·멘션 수는 여기서 주지 않는다 —
 * 폴링 응답(`/api/board-room/work/sync`의 `badges`)이 같은 값을 주기마다 싣는다. 업무 화면 안에서는 셸이 이미 받은
 * 목록 데이터로 메뉴를 채우므로 부르지 않는다.
 */
export async function getWorkMenuSummary(): Promise<ActionResult<WorkMenuSummary>> {
  const ctx = await requireWorkStaff()
  try {
    const [{ channels, dms }, openTaskCount] = await Promise.all([
      listSidebarChannels(ctx, ctx.user.id),
      countMyOpenTasks(ctx, ctx.user.id),
    ])
    const conversations: MenuConversationMeta = {}
    for (const c of channels) conversations[c.id] = { dm: false, muted: c.muted === true }
    for (const d of dms) conversations[d.id] = { dm: true, muted: d.muted === true }
    return ok({ conversations, openTaskCount })
  } catch (err) {
    return dbFailure('getWorkMenuSummary', err)
  }
}
