import { readSessionUser } from '@/lib/server/session'
import type { SessionUser } from '@/lib/server/session'
import { getProfileById } from '@/db/queries/profiles'
import { withTimeout, FETCH_TIMEOUT_MS } from '@/middleware/profile'

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
 * `ProfileRow`(33개 컬럼 전부 — `account_number`·`bank_name`·`real_name`·
 * `phone_number`·`birth_date` 같은 민감 컬럼 포함)를 세션 판정에만 필요한
 * `ProfileLike`의 5개 필드로 좁힌다. 전환 전 `getSessionContext`는
 * `.select('is_admin, is_director, is_auditor, registration_status,
 * is_active')`로 정확히 이 5개만 실었다 — `getProfileById`가 전체 행을
 * 돌려주게 된 지금도 `SessionContext.profile`은 같은 모양이어야 한다.
 *
 * 이 투영이 없으면(리뷰 라운드 1 Important): `strict: false` + `ProfileLike`
 * 전 필드 optional 조합에서, 미래의 어떤 라우트가 `session.profile`(또는
 * `requireActiveMember()`가 그대로 넘겨주는 `auth.profile`)을 통째로
 * 응답에 얹는 순간 타입 검사도 스키마 계약 검사도 경고 없이 통과하고
 * 다른 조합원의 계좌번호·실명이 화면에 실린다. `verify-session`(8개 필드
 * 명시 조립)·`checkAdminPermission`(3개 필드 트리밍)은 이미 이 이유로
 * 좁혀놨다 — 여기도 같은 방식으로 좁혀 세 반환 경로를 일관되게 만든다.
 *
 * 프로퍼티를 명시적으로 나열해 새 객체를 만드는 방식이라, 인자로 들어온
 * 값에 이 5개 말고 다른 키가 몇 개든 실려 있어도(런타임에 실제로 실려
 * 있다 — `ProfileLike` 타입은 그 초과분을 감추기만 할 뿐 지우지 않는다)
 * 결과 객체에는 옮겨지지 않는다.
 */
function toSessionProfileFields(profile: ProfileLike): ProfileLike {
  return {
    is_admin: profile.is_admin,
    is_director: profile.is_director,
    is_auditor: profile.is_auditor,
    registration_status: profile.registration_status,
    is_active: profile.is_active,
  }
}

/**
 * `userId`로 프로필을 조회해 `SessionContext`의 `profile`/`profileError`를
 * 만든다. `fetchProfile`은 테스트에서 실제 SQLite로 null/throw 계약과
 * 타임아웃을 검증하기 위한 주입 인자다(`middleware/profile.ts`의
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
 *
 * `middleware/profile.ts`의 `withTimeout`/`FETCH_TIMEOUT_MS`(3초)를 그대로
 * 재사용해 조회를 감싼다(리뷰 라운드 1 Minor 4) — `getSessionContext()`는
 * 인증된 거의 모든 API 요청에서 실행되고, 게시글·좋아요·댓글 라우트는
 * `export const maxDuration = 30`이라 Turso가 멎으면 요청 하나가 최대 30초
 * 함수를 붙잡아 동시성을 소진시킬 수 있다. 타임아웃도 "조회 실패"이므로
 * `catch`가 잡아 `profileError`로 떨어진다(삼켜서 `profile: null`만 만들지
 * 않는다 — `memberAuth.ts`/`boardRoomAuth.ts`/`adminAuth.ts`가 `profileError`
 * 를 차단 조건으로 함께 보므로 결과는 같지만, "조회 실패"라는 사실 자체는
 * 보존해야 한다).
 */
export async function resolveSessionProfile(
  userId: string,
  fetchProfile: (id: string) => Promise<ProfileLike | null> = getProfileById
): Promise<{ profile: ProfileLike | null; profileError?: unknown }> {
  try {
    const profile = await withTimeout(
      fetchProfile(userId),
      FETCH_TIMEOUT_MS,
      `resolveSessionProfile: ${FETCH_TIMEOUT_MS}ms 안에 응답하지 않았다`
    )
    return { profile: profile ? toSessionProfileFields(profile) : null }
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
