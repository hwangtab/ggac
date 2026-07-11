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
// 세대(epoch) 토큰: force 호출·로그아웃이 이 값을 올려 이전 in-flight 요청을
// stale로 만든다. 없으면 "마지막 settle 승리"라, 로그인 직전 시작된 비강제
// 요청(미인증)이 force 요청(인증)보다 늦게 resolve할 때 낡은 상태가 캐시를
// 덮어쓰고, 로그아웃 후 in-flight 요청이 인증 상태를 되살린다(코드리뷰 CONFIRMED).
let epoch = 0

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

  const myEpoch = ++epoch
  const p: Promise<VerifiedSession> = requestSessionProfile()
    .then(session => {
      // 내가 최신 세대일 때만 캐시에 반영 — 이후 세대(force·로그아웃·재호출)가
      // 시작됐다면 이 결과는 stale이므로 캐시를 덮어쓰지 않는다.
      if (myEpoch === epoch) {
        cachedSession = session
        cachedAt = Date.now()
      }
      return session
    })
    .catch(() => {
      if (myEpoch === epoch) {
        cachedSession = null
        cachedAt = 0
      }
      return EMPTY_SESSION
    })
    .finally(() => {
      // 내가 건 in-flight일 때만 해제 — 다른 세대가 이미 새 요청을 걸었으면 건드리지 않는다.
      if (inflight === p) inflight = null
    })

  inflight = p
  return p
}

/** 로그인/로그아웃 등 인증 상태 전환 직후 호출 — 캐시를 무시하고 재검증한다. */
export function refreshSessionProfile(): Promise<VerifiedSession> {
  return fetchSessionProfile({ force: true })
}

/** 로그아웃 처리 직후 즉시 미인증 상태를 반영하고 싶을 때 사용한다. */
export function clearSessionProfileCache(): void {
  // epoch를 올려 in-flight 요청이 로그아웃 이후 인증 상태를 재캐시하지 못하게 한다.
  epoch++
  cachedSession = null
  cachedAt = 0
  inflight = null
}

export function isApprovedActiveAdmin(profile: VerifiedSessionProfile | null): boolean {
  return (
    profile?.registration_status === 'approved' &&
    profile.is_active === true &&
    profile.is_admin === true
  )
}
