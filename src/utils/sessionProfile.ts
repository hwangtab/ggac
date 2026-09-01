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
  /**
   * 탈퇴 신청 시각. `registration_status`는 신청 중에도 `'approved'`로
   * 남으므로(0011 참조), 마이페이지 설정 화면은 이 필드로 신청/취소 버튼을
   * 가른다.
   */
  withdrawal_requested_at?: string | null
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

/**
 * 인증 상태가 실제로 바뀐 순간 알리는 브라우저 이벤트.
 * 로그인 후 페이지 이동이 없는 경로(redirect 파라미터 없는 로그인)에서는
 * Navigation의 pathname 기반 재조회가 걸리지 않아 내비가 로그인 전 상태로
 * 남는다. 캐시를 쥔 이 모듈이 변화를 알리는 게 유일하게 새는 곳 없는 지점이다.
 */
export const SESSION_CHANGE_EVENT = 'gac:session-change'

function emitSessionChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT))
}

/** 같은 사용자·같은 권한이면 알리지 않는다 — 구독자가 되돌아 호출해도 루프가 없다. */
function isSameIdentity(a: VerifiedSession | null, b: VerifiedSession | null): boolean {
  if (a?.user?.id !== b?.user?.id) return false
  return (
    !!a?.profile?.is_admin === !!b?.profile?.is_admin &&
    !!a?.profile?.is_director === !!b?.profile?.is_director &&
    !!a?.profile?.is_auditor === !!b?.profile?.is_auditor &&
    a?.profile?.registration_status === b?.profile?.registration_status &&
    !!a?.profile?.is_active === !!b?.profile?.is_active
  )
}

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
        const changed = !isSameIdentity(cachedSession, session)
        cachedSession = session
        cachedAt = Date.now()
        if (changed) emitSessionChange()
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
  const hadSession = !!cachedSession?.user
  epoch++
  cachedSession = null
  cachedAt = 0
  inflight = null
  if (hadSession) emitSessionChange()
}

export function isApprovedActiveAdmin(profile: VerifiedSessionProfile | null): boolean {
  return (
    profile?.registration_status === 'approved' &&
    profile.is_active === true &&
    profile.is_admin === true
  )
}

/**
 * 이사회 전용 기능(일정 투표·출석·서류함·정기총회, 그리고 모든 쓰기)을 화면에
 * 보여도 되는지. 서버의 `canAccessBoardRoom`과 같은 기준이다.
 *
 * 이건 **표시 판정일 뿐 경계가 아니다.** 실제 차단은 API의
 * `requireBoardMember`와 미들웨어가 한다 — 여기서 버튼을 감추는 것은 조합원에게
 * 눌러도 403이 나는 UI를 보여주지 않기 위한 것이다.
 */
export function canAccessBoardRoom(profile: VerifiedSessionProfile | null): boolean {
  return (
    profile?.registration_status === 'approved' &&
    profile.is_active === true &&
    (profile.is_director === true || profile.is_admin === true || profile.is_auditor === true)
  )
}
