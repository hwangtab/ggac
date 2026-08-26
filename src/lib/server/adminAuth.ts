import { NextResponse } from 'next/server'
import { getSessionContext, isApprovedActiveAdmin } from '@/lib/server/authz'
import { getProfileById } from '@/db/queries/profiles'

export type AdminAuthSuccess = {
  user: { id: string }
}

/**
 * 관리자 인증 공유 유틸리티.
 *
 * - 미인증: 401 NextResponse 반환
 * - 프로필 조회 실패: 500 NextResponse 반환
 * - is_admin false / registration_status != 'approved' / is_active false: 403 NextResponse 반환
 *
 * 단계 4 Task 5 이전에는 통과 시 service-role Supabase 클라이언트(`db`)를 함께
 * 돌려줬다. 데이터 권위가 전부 Turso로 넘어가면서 그 클라이언트를 실제로 쓰는
 * 호출부가 하나도 남지 않아 반환값에서 뺐다 — 라우트는 `@/db/queries/*`를
 * 직접 부른다.
 *
 * 사용 예:
 *   const auth = await requireAdmin()
 *   if (auth instanceof NextResponse) return auth
 *   const { user } = auth
 */
export async function requireAdmin(): Promise<AdminAuthSuccess | NextResponse> {
  const session = await getSessionContext()

  if (!session.authenticated || !session.user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  if (session.profileError || !session.profile) {
    return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
  }

  if (!isApprovedActiveAdmin(session.profile)) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }

  return { user: { id: session.user.id } }
}

/**
 * settings 라우트들에서 사용하는 throw 방식 헬퍼 (기존 패턴 유지).
 * 새 라우트는 requireAdmin()을 사용할 것.
 *
 * 조회 자체가 실패(throw)해도, 행이 없어도(`null`) 똑같이 "프로필 정보를
 * 조회할 수 없습니다"로 막는다 — 이전 Supabase `.single()`이 두 경우 모두
 * `error`를 채워 구분 없이 막던 것과 같은 결과(fail-closed)다.
 */
export async function checkAdminPermission(userId: string) {
  let profile: Awaited<ReturnType<typeof getProfileById>>
  try {
    profile = await getProfileById(userId)
  } catch {
    throw new Error('프로필 정보를 조회할 수 없습니다.')
  }

  if (!profile) {
    throw new Error('프로필 정보를 조회할 수 없습니다.')
  }

  if (!isApprovedActiveAdmin(profile)) {
    throw new Error('관리자 권한이 필요합니다.')
  }

  return {
    is_admin: profile.is_admin,
    registration_status: profile.registration_status,
    is_active: profile.is_active,
  }
}
