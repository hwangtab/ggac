import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireServerEnv } from '@/lib/server/env'

export type ServiceRoleSupabaseClient = SupabaseClient

export function hasServiceRoleEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  )
}

// Supabase 행(hang) 시 함수 타임아웃까지 매달리지 않도록 요청 상한을 둔다.
const SUPABASE_FETCH_TIMEOUT_MS = 8000

export function createServiceRoleClient(): ServiceRoleSupabaseClient {
  const supabaseUrl = requireServerEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = requireServerEnv('SUPABASE_SERVICE_ROLE_KEY')

  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS),
        }),
    },
  })
}
