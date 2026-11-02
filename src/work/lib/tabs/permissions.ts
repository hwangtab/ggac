/**
 * 탭 권한 판정(순수) — 0023 의 RLS 와 같은 규칙으로 버튼 노출만 정한다. 실제 차단은 DB 가 한다.
 *   추가: 대화 멤버이면서 내부 staff(게스트 제외)
 *   이름 변경·제거: DM·그룹은 내부 staff 멤버(0026 — 게스트 제외), 채널은 만든 사람 · 채널 owner · 업무툴 관리자
 */
export type TabActor = {
  meId: string
  isAdmin: boolean
  isGuest: boolean
  isMember: boolean
  isChannelOwner: boolean
}

export function canAddTab(a: Pick<TabActor, 'isGuest' | 'isMember'>): boolean {
  return a.isMember && !a.isGuest
}

export function canManageTab(
  a: TabActor,
  tab: { createdBy: string },
  conversation: { isDm: boolean }
): boolean {
  if (conversation.isDm) return a.isMember && !a.isGuest
  if (a.isMember && !a.isGuest && tab.createdBy.toLowerCase() === a.meId.toLowerCase()) return true
  return a.isChannelOwner || a.isAdmin
}
