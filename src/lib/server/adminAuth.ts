import { NextResponse } from 'next/server'
import { getSessionContext, isApprovedActiveAdmin } from '@/lib/server/authz'
import { createServiceRoleClient, type ServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin'
import { getProfileById } from '@/db/queries/profiles'
import { createLogger } from '@/utils/logger'

const log = createLogger('adminAuth')

export type AdminAuthSuccess = {
  db: ServiceRoleSupabaseClient
  user: { id: string }
}

type ProfileQueryClient = Pick<ServiceRoleSupabaseClient, 'from'>

function createAdminDbOrResponse(): ServiceRoleSupabaseClient | NextResponse {
  try {
    return createServiceRoleClient()
  } catch {
    log.error('SUPABASE_SERVICE_ROLE_KEY 또는 NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.')
    return NextResponse.json({ error: '서버 구성 오류입니다.' }, { status: 500 })
  }
}

/**
 * 관리자 인증 및 서비스 롤 클라이언트 생성을 한 번에 처리하는 공유 유틸리티.
 *
 * - 미인증: 401 NextResponse 반환
 * - 프로필 조회 실패: 500 NextResponse 반환
 * - is_admin false / registration_status != 'approved' / is_active false: 403 NextResponse 반환
 * - SUPABASE_SERVICE_ROLE_KEY 없음: 500 NextResponse 반환 (무음 폴백 방지)
 *
 * 사용 예:
 *   const auth = await requireAdmin()
 *   if (auth instanceof NextResponse) return auth
 *   const { db } = auth
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

  const db = createAdminDbOrResponse()
  if (db instanceof NextResponse) return db

  return { db, user: { id: session.user.id } }
}

/**
 * settings 라우트들에서 사용하는 throw 방식 헬퍼 (기존 패턴 유지).
 * 새 라우트는 requireAdmin()을 사용할 것.
 *
 * 첫 인자(`_supabase`)는 더 이상 프로필 조회에 쓰이지 않는다 — 프로필의
 * 권위는 Turso다(`getProfileById`). 호출부(`settingsAdminAuth.ts`)가 여전히
 * service-role Supabase 클라이언트를 넘기므로 시그니처는 유지한다(범위 밖
 * 파일의 호출부를 바꾸지 않는다).
 * 조회 자체가 실패(throw)해도, 행이 없어도(`null`) 똑같이 "프로필 정보를
 * 조회할 수 없습니다"로 막는다 — 이전 Supabase `.single()`이 두 경우 모두
 * `error`를 채워 구분 없이 막던 것과 같은 결과(fail-closed)다.
 */
export async function checkAdminPermission(_supabase: ProfileQueryClient, userId: string) {
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
