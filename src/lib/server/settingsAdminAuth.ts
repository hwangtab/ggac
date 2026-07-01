import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { checkAdminPermission } from '@/lib/server/adminAuth'
import { createErrorResponse } from '@/utils/apiResponse'

export type SettingsAdminAuth = {
  db: Awaited<ReturnType<typeof createSupabaseServer>>
  user: { id: string }
}

export type SettingsAdminAuthOptions = {
  unauthorizedResponse?: () => NextResponse
}

export async function requireSettingsAdmin(
  options: SettingsAdminAuthOptions = {}
): Promise<SettingsAdminAuth | NextResponse> {
  const db = await createSupabaseServer()
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser()

  if (authError || !user) {
    return (
      options.unauthorizedResponse?.() ??
      createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    )
  }

  await checkAdminPermission(db, user.id)

  return { db, user: { id: user.id } }
}

export function createSettingsAdminAuth(options: SettingsAdminAuthOptions = {}) {
  return () => requireSettingsAdmin(options)
}
