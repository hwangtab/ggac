/**
 * 미들웨어에서 `member_profiles`를 읽는 유일한 경로.
 *
 * 단계 2c부터 프로필의 권위는 Turso다. `src/db/queries/profiles.ts`의
 * `getProfileById`를 그대로 쓴다 — Turso `member_profiles`에는 RLS가 없으므로
 * (이전 Supabase 구현이 서비스롤로 우회해야 했던 문제 자체가 사라졌다) 별도
 * 우회 클라이언트가 필요 없다.
 *
 * 인가는 이 조회가 아니라 호출부(`handleAuth`)가 프로필 값을 보고 판단한다.
 * 이 함수는 **주어진 userId 한 명의 행만** 읽고, userId는 검증된 세션에서만
 * 온다.
 */

// 상대 경로 + 명시적 .ts 확장자를 쓴다: 이 파일은 `scripts/testing/middleware-profile.test.mjs`가
// `node --experimental-strip-types`로 직접 import해서 검증한다(널 vs throw 계약을 실제 SQLite로
// 확인한다). `@/` 별칭은 Next.js 번들러 전용이라 plain Node에서는 전혀 resolve되지 않는다.
import { getProfileById, type ProfileRow } from '../db/queries/profiles.ts'

export interface MiddlewareProfile {
  registration_status: string | null
  is_active: boolean | null
  is_admin: boolean | null
  is_director: boolean | null
  is_auditor: boolean | null
  display_name: string | null
}

/**
 * 이전 Supabase REST 구현(`AbortSignal.timeout(FETCH_TIMEOUT_MS)`)에 있던
 * 3초 타임아웃 보호. `getProfileById`(Drizzle/`@libsql/client`)는 fetch가
 * 아니라서 `AbortSignal`을 그대로 넘길 데가 없고, `@libsql/client`의
 * web/http 트랜스포트에도 기본 타임아웃이 없다 — 그래서 이 계층에서
 * 타이머 기반 래퍼(`withTimeout`)로 감싼다.
 *
 * 값은 이전 구현에서 그대로 가져왔다(왜 3초인지 아는 사람이 정한 값이므로
 * 바꾸지 않는다).
 */
const FETCH_TIMEOUT_MS = 3000

/**
 * `promise`가 `ms` 안에 끝나지 않으면 던진다. **삼키지 않는다** — 타임아웃도
 * "조회 실패"의 한 형태이므로 `fetchMemberProfileForMiddleware`의 null/throw
 * 계약에서 throw 쪽에 속한다(아래 참고). 원래 `promise`가 타임아웃 이후에도
 * 계속 실행되다가 나중에 resolve/reject될 수 있지만(취소하지 않는다 —
 * `getProfileById`는 취소 가능한 API를 노출하지 않는다), 그 결과는 여기서
 * 버려진다 — 호출부는 이미 던져진 타임아웃 에러로 넘어간 뒤이기 때문이다.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * "행이 없다"와 "조회를 못 했다"는 다른 사실이고, 호출부(`auth.ts`)는 그 둘을
 * 다르게 다뤄야 한다 — 원래 코드가 `catch` 블록에서 모바일 허용/공개 페이지 허용/
 * 보호 페이지는 로그인으로 리다이렉트라는 세 갈래를 따로 두고 있었기 때문이다.
 * 그래서 이 함수는 둘을 구분한다:
 *
 *  - 일치하는 행이 없음 → `null`을 반환한다. `auth.ts`의 `!profile` 분기가
 *    기존과 동일하게 처리한다(보호 페이지는 `/register/pending`).
 *  - 조회 자체가 실패함(DB 연결 오류 등, 그리고 userId가 없어 아예 조회를
 *    시도할 수 없는 경우) → 예외를 던진다. `auth.ts`의 기존 `catch` 블록이
 *    이를 받아 원래 분기(보호 페이지는 `/login`)를 그대로 수행한다.
 *
 * 이 구분은 `getProfileById`(`src/db/queries/profiles.ts`)가 이미 지킨다 —
 * 행이 없으면 `null`, 조회 자체가 실패하면 던진다. 이 함수는 그 계약을 그대로
 * 통과시킨다(타임아웃도 "조회 실패"로 취급해 던진다 — 아래 참고). **삼키지
 * 않는다** — 여기서 try/catch로 감싸 null로 뭉개면 `auth.ts`의 catch가
 * 지키던 두 실패의 구분이 사라지고, 조회 실패가 "행 없음"으로 위장되어
 * (엉뚱한 분기 — 로그인 리다이렉트 대신 /register/pending) 권한 없는
 * 사용자가 통과할 여지가 생긴다.
 *
 * 미들웨어가 죽지 않아야 한다는 요구는 이 함수가 삼켜서가 아니라 `auth.ts`에
 * 이미 있는 `try/catch`가 감당한다. 다만 그 catch가 걸리려면 이 함수가
 * **유한한 시간 안에** 반드시 resolve/reject해야 한다 — DB 조회가 걸리면
 * (Turso 응답 지연 등) 미들웨어 요청 하나가 무기한 대기하다가 Vercel Edge
 * 실행 시간 제한에 하드킬(504)당한다. `FETCH_TIMEOUT_MS` 안에 끝나지 않으면
 * 던져서 이 함수가 항상 유한 시간 안에 결론 나게 한다.
 *
 * `fetchProfile`은 테스트에서 지연 응답을 주입하기 위한 선택 인자다 —
 * 실제 호출부(`auth.ts`)는 두 번째 인자를 넘기지 않고 기본값(`getProfileById`)
 * 을 그대로 쓴다.
 */
export async function fetchMemberProfileForMiddleware(
  userId: string,
  fetchProfile: (id: string) => Promise<ProfileRow | null> = getProfileById
): Promise<MiddlewareProfile | null> {
  if (!userId) {
    // userId가 없는 건 "행이 없다"는 사실이 아니라 "확인할 수 없다"는
    // 사실이다. 조회 실패와 동일하게 던져서 호출부의 catch(로그인으로
    // 리다이렉트)를 타게 한다.
    throw new Error('fetchMemberProfileForMiddleware: userId가 없다')
  }

  const profile = await withTimeout(
    fetchProfile(userId),
    FETCH_TIMEOUT_MS,
    `fetchMemberProfileForMiddleware: ${FETCH_TIMEOUT_MS}ms 안에 응답하지 않았다`
  )
  if (!profile) return null

  return {
    registration_status: profile.registration_status,
    is_active: profile.is_active,
    is_admin: profile.is_admin,
    is_director: profile.is_director,
    is_auditor: profile.is_auditor,
    display_name: profile.display_name,
  }
}
