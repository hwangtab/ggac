/**
 * 미들웨어에서 `member_profiles`를 읽는 유일한 경로.
 *
 * 왜 서비스롤인가: 기존 구현(`auth.ts`)은 anon 키 + 요청 쿠키로 만든
 * 서버 클라이언트(@supabase/ssr)로 조회했다. 그 클라이언트는 RLS를 받으므로, 단계 2b-6에서
 * Supabase 세션이 사라지면 `auth.uid()`가 NULL이 되어 정책이 거짓이 된다.
 * RLS는 거부하지 않고 **감추므로** 오류 없이 빈 결과가 오고, 미들웨어는
 * `profile = null`로 판단해 승인된 조합원 전원을 `/register/pending`으로 보낸다.
 * 서비스롤은 RLS를 우회하므로 전환 전후로 같은 행을 돌려준다.
 *
 * 인가는 이 조회가 아니라 호출부(`handleAuth`)가 프로필 값을 보고 판단한다 —
 * 여기서 서비스롤을 쓴다고 권한이 넓어지지는 않는다. 이 함수는 **주어진
 * userId 한 명의 행만** 읽고, userId는 검증된 세션에서만 온다.
 */

export interface MiddlewareProfile {
  registration_status: string | null
  is_active: boolean | null
  is_admin: boolean | null
  is_director: boolean | null
  is_auditor: boolean | null
  display_name: string | null
}

/** `src/middleware/auth.ts`가 읽던 컬럼 목록과 정확히 같아야 한다. */
const COLUMNS = 'registration_status,is_active,is_admin,is_director,is_auditor,display_name'

const FETCH_TIMEOUT_MS = 3000

/**
 * "행이 없다"와 "조회를 못 했다"는 다른 사실이고, 호출부(`auth.ts`)는 그 둘을
 * 다르게 다뤄야 한다 — 원래 코드가 `catch` 블록에서 모바일 허용/공개 페이지 허용/
 * 보호 페이지는 로그인으로 리다이렉트라는 세 갈래를 따로 두고 있었기 때문이다.
 * 그래서 이 함수는 둘을 구분한다:
 *
 *  - 일치하는 행이 없음(정상 응답, 빈 배열) → `null`을 반환한다. `auth.ts`의
 *    `!profile` 분기가 기존과 동일하게 처리한다(보호 페이지는 `/register/pending`).
 *  - 조회 자체가 실패함(네트워크 오류·타임아웃·비정상 응답 코드·본문 파싱 실패,
 *    그리고 URL/서비스롤 키/userId 중 하나라도 없어 아예 요청을 시도할 수 없는
 *    경우) → 예외를 던진다. `auth.ts`의 기존 `catch` 블록이 이를 받아 원래
 *    분기(보호 페이지는 `/login`)를 그대로 수행한다.
 *
 * 미들웨어가 죽지 않아야 한다는 요구는 이 함수가 삼켜서가 아니라 `auth.ts`에
 * 이미 있는 `try/catch`가 감당한다 — 여기서 삼키면 그 catch가 지키던, "조회
 * 실패"와 "행 없음"을 구분하는 원래 동작이 사라진다.
 */
export async function fetchMemberProfileForMiddleware(
  userId: string
): Promise<MiddlewareProfile | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !userId) {
    // 설정 누락은 "행이 없다"는 사실이 아니라 "확인할 수 없다"는 사실이다.
    // 조회 실패와 동일하게 던져서 호출부의 catch(로그인으로 리다이렉트)를 타게 한다.
    throw new Error(
      'fetchMemberProfileForMiddleware: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/userId 중 하나가 없다'
    )
  }

  const res = await fetch(
    `${url}/rest/v1/member_profiles?select=${COLUMNS}&id=eq.${encodeURIComponent(userId)}&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  )
  if (!res.ok) {
    throw new Error(`fetchMemberProfileForMiddleware: ${res.status} ${res.statusText}`)
  }
  const rows = (await res.json()) as MiddlewareProfile[]
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}
