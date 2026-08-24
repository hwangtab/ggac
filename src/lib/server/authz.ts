import { readSessionUser } from '@/lib/server/session'
import type { SessionUser } from '@/lib/server/session'
import { getProfileById } from '@/db/queries/profiles'

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
 * `userId`로 프로필을 조회해 `SessionContext`의 `profile`/`profileError`를
 * 만든다. `fetchProfile`은 테스트에서 실제 SQLite로 null/throw 계약을
 * 검증하기 위한 주입 인자다(`middleware/profile.ts`의
 * `fetchMemberProfileForMiddleware`와 같은 패턴) — 운영 호출부
 * (`getSessionContext`)는 두 번째 인자를 넘기지 않고 기본값(`getProfileById`)을
 * 그대로 쓴다. `getSessionContext` 자체는 `readSessionUser()`가 Next.js
 * `headers()`에 의존해 요청 스코프 밖(플레인 테스트)에서는 항상 `user: null`로
 * 귀결되므로, 이 함수를 분리해야 프로필 조회 로직을 요청 스코프 없이
 * 단위 테스트할 수 있다.
 *
 * 행이 없으면 `profile: null`만 세팅한다(`profileError` 없음) — 아래
 * 소비자(adminAuth/boardRoomAuth/memberAuth)는 전부 `profileError ||
 * !profile`을 함께 검사하므로 `!profile`만으로 이전 Supabase `.single()`의
 * "행 없음도 error"이던 동작과 같은 결과(차단)를 낸다. `profileError`는
 * 조회 자체가 실패했을 때만(예: DB 연결 오류) 채운다 — "행 없음"과 "조회
 * 실패"를 구분하되, 두 경우 모두 하위 소비자에게는 여전히 차단으로
 * 이어진다(fail-closed 유지, 의미는 그대로 보존).
 */
export async function resolveSessionProfile(
  userId: string,
  fetchProfile: (id: string) => Promise<ProfileLike | null> = getProfileById
): Promise<{ profile: ProfileLike | null; profileError?: unknown }> {
  try {
    const profile = await fetchProfile(userId)
    return { profile }
  } catch (profileError) {
    return { profile: null, profileError }
  }
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

  const { profile, profileError } = await resolveSessionProfile(user.id)
  return {
    authenticated: true,
    user,
    profile,
    profileError,
  }
}
