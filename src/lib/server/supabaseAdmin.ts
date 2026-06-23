import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireServerEnv } from '@/lib/server/env'

export type ServiceRoleSupabaseClient = SupabaseClient

export function hasServiceRoleEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  )
}

export function createServiceRoleClient(): ServiceRoleSupabaseClient {
  const supabaseUrl = requireServerEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = requireServerEnv('SUPABASE_SERVICE_ROLE_KEY')

  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
