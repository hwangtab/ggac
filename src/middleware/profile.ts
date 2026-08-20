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
 * 실패를 던지지 않고 `null`로 돌려준다. 미들웨어에서 예외가 나면 모든 요청이
 * 500이 되어 사이트 전체가 죽는다 — 기존 구현도 try/catch로 삼켰고, 그 동작을
 * 그대로 유지한다.
 */
export async function fetchMemberProfileForMiddleware(
  userId: string
): Promise<MiddlewareProfile | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !userId) return null

  try {
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
    if (!res.ok) return null
    const rows = (await res.json()) as MiddlewareProfile[]
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
  } catch {
    return null
  }
}
