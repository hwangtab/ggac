import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
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

export async function createSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    // Build/prerender 시에는 환경변수가 없을 수 있으므로 경고만 출력
    log.warn(
      'Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  const cookieStore = await cookies()
  return createServerClient(url || '', anonKey || '', {
    global: { fetch: fetchWithTimeout },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // The `setAll` method is called from a Server Component.
          // This can be ignored if you have middleware refreshing user sessions.
        }
      },
    },
  })
}
