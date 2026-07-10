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

const EMPTY_SESSION: VerifiedSession = {
  authenticated: false,
  user: null,
  profile: null,
}

// Navigation·activityLogger·좋아요 훅·board 헤더 등 여러 소비자가 같은 정보를
// 제각각 fetch하던 것을 모듈 레벨에서 단일화한다.
//  - in-flight 공유: 동시 호출(하이드레이션 버스트, 탭 복귀 focus+visibilitychange)이
//    네트워크 요청 1건으로 합쳐진다.
//  - TTL 캐시: TTL 안의 반복 호출(라우트 전환마다의 재조회 등)은 네트워크를 타지 않는다.
//  - 로그인/로그아웃 직후에는 refreshSessionProfile()로 강제 갱신한다.
const SESSION_CACHE_TTL_MS = 30_000

let cachedSession: VerifiedSession | null = null
let cachedAt = 0
let inflight: Promise<VerifiedSession> | null = null

async function requestSessionProfile(): Promise<VerifiedSession> {
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
    return EMPTY_SESSION
  }

  return {
    authenticated: true,
    user: data.user ?? null,
    profile: data.profile ?? null,
  }
}

export async function fetchSessionProfile(
  options: { force?: boolean } = {}
): Promise<VerifiedSession> {
  if (!options.force) {
    if (cachedSession && Date.now() - cachedAt < SESSION_CACHE_TTL_MS) {
      return cachedSession
    }
    if (inflight) {
      return inflight
    }
  }

  inflight = requestSessionProfile()
    .then(session => {
      cachedSession = session
      cachedAt = Date.now()
      return session
    })
    .catch(() => {
      // 네트워크 실패는 캐시하지 않고 미인증으로 처리 — 다음 호출이 재시도한다.
      cachedSession = null
      cachedAt = 0
      return EMPTY_SESSION
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

/** 로그인/로그아웃 등 인증 상태 전환 직후 호출 — 캐시를 무시하고 재검증한다. */
export function refreshSessionProfile(): Promise<VerifiedSession> {
  return fetchSessionProfile({ force: true })
}

/** 로그아웃 처리 직후 즉시 미인증 상태를 반영하고 싶을 때 사용한다. */
export function clearSessionProfileCache(): void {
  cachedSession = null
  cachedAt = 0
}

export function isApprovedActiveAdmin(profile: VerifiedSessionProfile | null): boolean {
  return (
    profile?.registration_status === 'approved' &&
    profile.is_active === true &&
    profile.is_admin === true
  )
}
