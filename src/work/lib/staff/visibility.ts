import { visibleStaffIds } from '@/lib/server/boardWorkChannelAuth'
import type { WorkStaffRole } from '@/lib/server/boardWorkAuth'
import type { WorkServerClient } from '@work/lib/supabase/server'

/**
 * 게스트가 볼 수 있는 사람 — 원본 kosmart-work `lib/staff/visibility.ts`와 같은 이름·모양.
 * 규칙(원본 visible_staff_ids, 0026)은 `src/lib/server/boardWorkChannelAuth.ts`의 `visibleStaffIds`에 있다.
 * 내부 구성원(owner·admin·member)은 제한이 없다(null). 1단계에는 게스트가 없다(설계 §3).
 * 두 번째 인자(me)는 원본 시그니처 유지용 — 판정은 가드의 사용자(`supabase`)로 한다.
 */
export async function guestVisibleUserIds(
  supabase: WorkServerClient,
  _me: { user_id: string; role: WorkStaffRole }
): Promise<Set<string> | null> {
  return visibleStaffIds({ userId: supabase.user.id, role: supabase.staff.role })
}

/** visible이 null(제한 없음)이면 그대로, 아니면 그 사람만. */
export function filterVisiblePeople<T>(
  people: T[],
  visible: Set<string> | null,
  idOf: (p: T) => string
): T[] {
  if (!visible) return people
  return people.filter(p => visible.has(idOf(p)))
}
