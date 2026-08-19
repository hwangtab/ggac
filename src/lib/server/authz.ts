import { readSessionUser } from '@/lib/server/session'
import type { SessionUser } from '@/lib/server/session'
import { createSupabaseServer } from '@/lib/supabase/server'

export type { SessionUser }

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

/**
 * 현재 요청의 세션 사용자와 member_profiles 프로필을 한 번에 조회한다.
 * 인증/권한 헬퍼(adminAuth, boardRoomAuth)가 이 단일 소스를 재사용해
 * getUser → 프로필 조회 시퀀스를 중복하지 않도록 한다.
 */
export async function getSessionContext(): Promise<SessionContext> {
  const user = await readSessionUser()

  if (!user) {
    return {
      authenticated: false,
      user: null,
      profile: null,
    }
  }

  const supabase = await createSupabaseServer()
  const { data: profile, error: profileError } = await supabase
    .from('member_profiles')
    .select('is_admin, is_director, is_auditor, registration_status, is_active')
    .eq('id', user.id)
    .single()

  return {
    authenticated: true,
    user,
    profile: profile ?? null,
    profileError,
  }
}
