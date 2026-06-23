import { NextResponse } from 'next/server'
import { canAccessBoardRoom, getSessionContext, isApprovedActiveAdmin } from '@/lib/server/authz'
import { createServiceRoleClient, type ServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin'
import { createLogger } from '@/utils/logger'

const log = createLogger('boardRoomAuth')

export type BoardAuthSuccess = {
  db: ServiceRoleSupabaseClient
  user: { id: string }
  isAdmin: boolean
  isAuditor: boolean
}

type ProfileQueryClient = Pick<ServiceRoleSupabaseClient, 'from'>

function createBoardRoomDbOrResponse(): ServiceRoleSupabaseClient | NextResponse {
  try {
    return createServiceRoleClient()
  } catch {
    log.error('SUPABASE_SERVICE_ROLE_KEY 또는 URL 미설정')
    return NextResponse.json({ error: '서버 구성 오류입니다.' }, { status: 500 })
  }
}

/**
 * 이사회 전용 API 권한 헬퍼.
 * - 미인증: 401
 * - 프로필 조회 실패: 500
 * - (is_director=false AND is_admin=false AND is_auditor=false) / 미승인 / 비활성: 403
 * - service-role 키 없음: 500
 * 성공 시 service-role db 클라이언트와 user, isAdmin, isAuditor 반환.
 * 감사(is_auditor)는 감사 업무를 위해 이사회에 접근하나 정족수에는 산입되지 않는다.
 */
export async function requireBoardMember(): Promise<BoardAuthSuccess | NextResponse> {
  const session = await getSessionContext()

  if (!session.authenticated || !session.user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  if (session.profileError || !session.profile) {
    return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
  }

  if (!canAccessBoardRoom(session.profile)) {
    return NextResponse.json({ error: '이사회 접근 권한이 없습니다.' }, { status: 403 })
  }

  const db = createBoardRoomDbOrResponse()
  if (db instanceof NextResponse) return db

  return {
    db,
    user: { id: session.user.id },
    isAdmin: isApprovedActiveAdmin(session.profile),
    isAuditor: session.profile.is_auditor === true,
  }
}

/** 관리자 전용 동작(회의 생성·확정·출석 체크 등) 가드 */
export function requireBoardAdmin(auth: BoardAuthSuccess): NextResponse | null {
  if (!auth.isAdmin) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }
  return null
}

/** 재적 이사 명단(승인·활성 + is_director). 정족수 산정 기준이 된다. */
export async function getDirectorRoster(db: ProfileQueryClient) {
  const { data, error } = await db
    .from('member_profiles')
    .select('id, display_name, director_title')
    .eq('is_director', true)
    .eq('is_active', true)
    .eq('registration_status', 'approved')
  if (error) throw error
  return data ?? []
}

/**
 * 감사 명단(승인·활성 + is_auditor).
 * 이사회 참석·기록 대상이지만 정족수에는 산입되지 않는다.
 */
export async function getAuditorRoster(db: ProfileQueryClient) {
  const { data, error } = await db
    .from('member_profiles')
    .select('id, display_name, director_title')
    .eq('is_auditor', true)
    .eq('is_active', true)
    .eq('registration_status', 'approved')
  if (error) throw error
  return data ?? []
}
