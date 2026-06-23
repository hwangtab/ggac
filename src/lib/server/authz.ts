import { createSupabaseServer } from '@/lib/supabase/server'
import { createServiceRoleClient, type ServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin'
import { ApiError } from '@/utils/apiWrapper'

export interface SessionUser {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
}

export interface ProfileLike {
  is_admin?: boolean | null
  is_director?: boolean | null
  is_auditor?: boolean | null
  registration_status?: string | null
  is_active?: boolean | null
}

export interface SessionContext {
  authenticated: boolean
  user: SessionUser | null
  profile: ProfileLike | null
  sessionError?: unknown
  profileError?: unknown
}

export interface AdminContext {
  db: ServiceRoleSupabaseClient
  user: { id: string }
  profile: ProfileLike
}

export interface BoardMemberContext extends AdminContext {
  isAdmin: boolean
  isAuditor: boolean
}

export function isApprovedActive(profile: ProfileLike | null): boolean {
  return profile?.registration_status === 'approved' && profile.is_active === true
}

export function isApprovedActiveAdmin(profile: ProfileLike | null): boolean {
  return isApprovedActive(profile) && profile?.is_admin === true
}

export function canAccessBoardRoom(profile: ProfileLike | null): boolean {
  return (
    isApprovedActive(profile) &&
    (profile?.is_director === true || profile?.is_admin === true || profile?.is_auditor === true)
  )
}

export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createSupabaseServer()

  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser()

  if (sessionError || !user) {
    return {
      authenticated: false,
      user: null,
      profile: null,
      sessionError,
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('member_profiles')
    .select('is_admin, is_director, is_auditor, registration_status, is_active')
    .eq('id', user.id)
    .single()

  return {
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      email_confirmed_at: user.email_confirmed_at,
    },
    profile: profile ?? null,
    profileError,
  }
}

function createServiceRoleClientOrApiError(): ServiceRoleSupabaseClient {
  try {
    return createServiceRoleClient()
  } catch {
    throw ApiError.internalServerError('서버 구성 오류입니다.')
  }
}

export async function requireAdminContext(): Promise<AdminContext> {
  const session = await getSessionContext()

  if (!session.authenticated || !session.user) {
    throw ApiError.unauthorized('인증이 필요합니다.')
  }

  if (session.profileError || !session.profile) {
    throw ApiError.internalServerError('프로필 정보를 조회할 수 없습니다.')
  }

  if (!isApprovedActiveAdmin(session.profile)) {
    throw ApiError.forbidden('관리자 권한이 필요합니다.')
  }

  return {
    db: createServiceRoleClientOrApiError(),
    user: { id: session.user.id },
    profile: session.profile,
  }
}

export async function requireBoardMemberContext(): Promise<BoardMemberContext> {
  const session = await getSessionContext()

  if (!session.authenticated || !session.user) {
    throw ApiError.unauthorized('인증이 필요합니다.')
  }

  if (session.profileError || !session.profile) {
    throw ApiError.internalServerError('프로필 정보를 조회할 수 없습니다.')
  }

  if (!canAccessBoardRoom(session.profile)) {
    throw ApiError.forbidden('이사회 접근 권한이 없습니다.')
  }

  return {
    db: createServiceRoleClientOrApiError(),
    user: { id: session.user.id },
    profile: session.profile,
    isAdmin: isApprovedActiveAdmin(session.profile),
    isAuditor: session.profile.is_auditor === true,
  }
}

export function requireBoardAdminContext(context: BoardMemberContext): void {
  if (!context.isAdmin) {
    throw ApiError.forbidden('관리자 권한이 필요합니다.')
  }
}
