export interface VerifiedSessionUser {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
}

export interface VerifiedSessionProfile {
  registration_status?: string | null
  is_active?: boolean | null
  display_name?: string | null
  is_admin?: boolean | null
  is_artist?: boolean | null
  artist_id?: string | null
  is_director?: boolean | null
  is_auditor?: boolean | null
}

export interface VerifiedSession {
  authenticated: boolean
  user: VerifiedSessionUser | null
  profile: VerifiedSessionProfile | null
}

export async function fetchSessionProfile(): Promise<VerifiedSession> {
  const response = await fetch('/api/auth/verify-session', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })

  // 표준 응답 래퍼: { success, data: VerifiedSession }
  const json = (await response.json().catch(() => null)) as {
    data?: Partial<VerifiedSession>
  } | null
  const data = json?.data

  if (!response.ok || !data?.authenticated) {
    return {
      authenticated: false,
      user: null,
      profile: null,
    }
  }

  return {
    authenticated: true,
    user: data.user ?? null,
    profile: data.profile ?? null,
  }
}

export function isApprovedActiveAdmin(profile: VerifiedSessionProfile | null): boolean {
  return (
    profile?.registration_status === 'approved' &&
    profile.is_active === true &&
    profile.is_admin === true
  )
}
