import { createClient } from '@supabase/supabase-js'
import { createLogger } from '@/utils/logger'

const log = createLogger('supabase/server')

// Supabase가 응답하지 않을 때(행) 함수 타임아웃(수십 초)까지 매달리지 않도록
// 모든 요청에 상한을 둔다. 초과 시 TimeoutError로 즉시 실패 → 라우트 에러 경로로 회수.
const SUPABASE_FETCH_TIMEOUT_MS = 8000

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS),
  })
}

/**
 * **이 클라이언트는 신원을 담지 않는다.**
 *
 * 단계 2b-6(Task 4) 이전에는 anon 키 + 요청 쿠키로 만든 Supabase Auth 세션
 * 클라이언트였다 — 로그인한 사용자 본인으로 RLS를 통과했다. 지금은 인증이
 * Better Auth(Turso)로 넘어가 요청에 Supabase 세션 쿠키가 전혀 없으므로, 그
 * 방식은 RLS가 모든 행을 가려 `member_profiles` 조회가 항상 빈 결과를
 * 돌려주는 조용한 버그였다(`getSessionContext`가 `profile: null`을 반환하던
 * 원인).
 *
 * 그래서 이 함수는 이제 **서비스 롤 클라이언트**를 돌려준다 — RLS를 완전히
 * 우회한다. 함수 이름은 여전히 "server"이지 "service-role"이 아니라서
 * 오해를 부르지만, 56개 호출부를 한꺼번에 옮겨 적는 이름 변경은 이번
 * 작업 범위가 아니다(브리프 명시). 다음에 이 파일을 만지는 사람에게 남긴다:
 *
 * **인가(authorization)는 이 함수의 일이 아니다.** 호출부가
 * `@/lib/server/memberAuth`의 `requireUser()`/`requireActiveMember()`로
 * "누가 요청했는가·승인된 조합원인가"를 먼저 판정해야 한다. 이 클라이언트를
 * 손에 쥐었다고 해서 그 자체로 어떤 권한도 증명되지 않는다 — DB에 어떤
 * 쿼리든 실행할 수 있는 관리자 키일 뿐이다.
 */
export async function createSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    // Build/prerender 시에는 환경변수가 없을 수 있으므로 경고만 출력
    log.warn(
      'Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  return createClient(url || '', serviceRoleKey || '', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchWithTimeout },
  })
}
