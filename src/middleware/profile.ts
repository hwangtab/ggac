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
import { getProfileById } from '../db/queries/profiles.ts'

export interface MiddlewareProfile {
  registration_status: string | null
  is_active: boolean | null
  is_admin: boolean | null
  is_director: boolean | null
  is_auditor: boolean | null
  display_name: string | null
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
 * 통과시킨다. **삼키지 않는다** — 여기서 try/catch로 감싸 null로 뭉개면
 * `auth.ts`의 catch가 지키던 두 실패의 구분이 사라지고, 조회 실패가 "행 없음"
 * 으로 위장되어(엉뚱한 분기 — 로그인 리다이렉트 대신 /register/pending) 권한
 * 없는 사용자가 통과할 여지가 생긴다.
 *
 * 미들웨어가 죽지 않아야 한다는 요구는 이 함수가 삼켜서가 아니라 `auth.ts`에
 * 이미 있는 `try/catch`가 감당한다.
 */
export async function fetchMemberProfileForMiddleware(
  userId: string
): Promise<MiddlewareProfile | null> {
  if (!userId) {
    // userId가 없는 건 "행이 없다"는 사실이 아니라 "확인할 수 없다"는
    // 사실이다. 조회 실패와 동일하게 던져서 호출부의 catch(로그인으로
    // 리다이렉트)를 타게 한다.
    throw new Error('fetchMemberProfileForMiddleware: userId가 없다')
  }

  const profile = await getProfileById(userId)
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
