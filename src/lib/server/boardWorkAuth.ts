import { cache } from 'react'
import { redirect } from 'next/navigation'
import { canAccessBoardRoom, getSessionContext, isApprovedActiveAdmin } from '@/lib/server/authz'
import { getProfileById } from '@/db/queries/profiles'

/**
 * 이사회 업무툴(kosmart-work 이식) 서버 가드 — docs/board-work/01-설계.md §3·§5-1.
 *
 * 원본은 `work.staff` 표(초대로 들어온 사람)와 Postgres RLS가 접근을 막았다. 여기에는 둘 다 없다.
 * **구성원은 ggac 이사회 권한이 정하고**(`canAccessBoardRoom` — 승인·활성 + 이사/감사/관리자),
 * 채널 단위 읽기·쓰기 범위는 호출부가 이 가드 다음에 판정한다. 가드를 거치지 않은 업무툴 진입점은 없어야 한다 —
 * `scripts/testing/assert-runtime-risks.mjs`가 `src/work/**`의 `'use server'` 파일을 검사한다.
 *
 * - `requireWorkStaff()`  Server Component·Server Action용. 미로그인 → `/login`, 이사회 권한 없음 → `/board`
 *                         (미들웨어가 같은 경로를 먼저 막는다 — 이건 그 뒤의 2차 방어선이다).
 * - `requireWorkAdmin()`  위 + 관리자. 아니면 `/board-room/chat`.
 * - 라우트 핸들러(`/api/board-room/work/**`)는 기존 규약대로 `requireBoardMember()`를 먼저 부르고
 *   `loadWorkStaff(userId)`로 이 모양을 만든다(정적 가드가 `requireBoardMember` 호출을 요구한다).
 */

/** 원본 `work.staff.role`. owner는 ggac에 대응하는 사람이 없어 쓰지 않고, guest는 외부 인원을 들일 때 켠다. */
export type WorkStaffRole = 'owner' | 'admin' | 'member' | 'guest'

/**
 * 원본 `StaffRow`에서 화면이 실제로 읽는 열만, **원본과 같은 이름(snake_case)**으로 둔다 — 옮긴 컴포넌트를 고치지 않으려고.
 * 상태 메시지(`status_emoji`·`status_text`·`status_until`)는 1단계의 `work_member_prefs`가 채운다.
 */
export type WorkStaff = {
  user_id: string
  display_name: string
  title: string | null
  role: WorkStaffRole
  status: 'active'
}

export type WorkGuardContext = {
  user: { id: string; email?: string }
  staff: WorkStaff
}

/** 이사회 권한 → 업무툴 역할. 관리자면 admin(원본 0037: 비공개 채널 읽기·채널 관리), 그 밖의 이사·감사는 member. */
export function workRoleOf(
  profile: Parameters<typeof canAccessBoardRoom>[0]
): WorkStaffRole | null {
  if (!canAccessBoardRoom(profile)) return null
  return isApprovedActiveAdmin(profile) ? 'admin' : 'member'
}

export function isWorkAdminRole(role: WorkStaffRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * 이름·직함을 읽어 `WorkStaff`를 만든다. `getSessionContext`는 개인정보 때문에 프로필을 권한 필드 5개로 좁혀 두므로
 * 여기서 한 번 더 읽고, **화면에 필요한 두 열만** 꺼낸다(계좌·실명 같은 열은 돌려주지 않는다).
 */
export async function loadWorkStaff(userId: string): Promise<WorkStaff | null> {
  const profile = await getProfileById(userId)
  const role = workRoleOf(profile)
  if (!profile || !role) return null
  return {
    user_id: userId,
    display_name: profile.display_name?.trim() || '이름 없음',
    title: profile.director_title?.trim() || null,
    role,
    status: 'active',
  }
}

/** 요청당 한 번만 판정한다(원본 `getCurrentStaff`의 react cache와 같은 자리). */
const getWorkGuardContext = cache(
  async (): Promise<WorkGuardContext | 'unauthenticated' | 'forbidden'> => {
    const session = await getSessionContext()
    if (!session.authenticated || !session.user) return 'unauthenticated'
    // 프로필 조회 실패(profileError)도 막는다 — 실패를 "권한 있음"으로 접지 않는다.
    if (session.profileError || !canAccessBoardRoom(session.profile)) return 'forbidden'
    const staff = await loadWorkStaff(session.user.id)
    if (!staff) return 'forbidden'
    return { user: { id: session.user.id, email: session.user.email ?? undefined }, staff }
  }
)

export async function requireWorkStaff(): Promise<WorkGuardContext> {
  const ctx = await getWorkGuardContext()
  if (ctx === 'unauthenticated') redirect('/login?redirect=/board-room/chat')
  if (ctx === 'forbidden') redirect('/board')
  return ctx
}

export async function requireWorkAdmin(): Promise<WorkGuardContext> {
  const ctx = await requireWorkStaff()
  if (!isWorkAdminRole(ctx.staff.role)) redirect('/board-room/chat')
  return ctx
}
