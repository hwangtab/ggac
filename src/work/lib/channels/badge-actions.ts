'use server'

import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { dbFailure, ok, type ActionResult } from './action-result'
import type { SidebarBadgeSnapshot } from './badge-snapshot'
import { loadSidebarBadges } from './badges'

/**
 * 사이드바 배지만 다시 읽는다 — 원본 kosmart-work `lib/channels/badge-actions.ts`와 같은 이름·모양.
 * 조회가 하나라도 실패하면 0으로 둔갑시키지 않고 실패(ok:false)로 돌려준다(화면이 router.refresh로 폴백).
 * 결재(expense) 배지는 가져오지 않는다(지출결의는 원본 조직 전용 — 설계 §1) — 늘 undefined다.
 * 폴링 응답(`/api/board-room/work/sync`)의 `badges`도 같은 함수(`loadSidebarBadges`)로 만든다.
 */
export async function getSidebarBadges(): Promise<ActionResult<SidebarBadgeSnapshot>> {
  const ctx = await requireWorkStaff()
  try {
    return ok(await loadSidebarBadges(ctx))
  } catch (err) {
    return dbFailure('getSidebarBadges', err)
  }
}
