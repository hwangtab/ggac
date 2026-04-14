import { createBrowserClient } from '@supabase/ssr'

type SupabaseBrowserClient = ReturnType<typeof createBrowserClient>

let _supabaseClient: SupabaseBrowserClient | null = null

// 환경 변수 체크 함수
function hasValidSupabaseConfig(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

// 더미 클라이언트 생성 (빌드 타임용)
function createDummyClient() {
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'auth') {
          return {
            getUser: () => Promise.resolve({ data: { user: null }, error: null }),
            getSession: () => Promise.resolve({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
          }
        }
        if (prop === 'from') {
          return () => ({
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
              }),
            }),
            update: () => ({
              eq: () =>
                Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
            }),
            delete: () => ({
              eq: () => Promise.resolve({ error: new Error('Supabase not configured') }),
            }),
          })
        }
        return () => Promise.resolve({ data: null, error: new Error('Supabase not configured') })
      },
    }
  ) as any
}

export function getSupabaseClient() {
  if (!_supabaseClient) {
    if (hasValidSupabaseConfig()) {
      try {
        _supabaseClient = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )
      } catch (error) {
        console.warn('Failed to create Supabase client:', error)
        _supabaseClient = createDummyClient()
      }
    } else {
      console.warn('Supabase environment variables not configured, using dummy client')
      _supabaseClient = createDummyClient()
    }
  }
  return _supabaseClient
}

// 기존 호환성을 위한 export (getter 사용)
export const supabase = new Proxy({} as SupabaseBrowserClient, {
  get(target, prop) {
    const client = getSupabaseClient()
    return (client as any)[prop]
  },
})
