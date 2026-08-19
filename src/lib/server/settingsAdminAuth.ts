import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { checkAdminPermission } from '@/lib/server/adminAuth'
import { createErrorResponse } from '@/utils/apiResponse'
import { readSessionUser } from '@/lib/server/session'

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
  const user = await readSessionUser()

  if (!user) {
    return (
      options.unauthorizedResponse?.() ??
      createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    )
  }

  // checkAdminPermission은 비관리자·프로필 조회 실패 시 throw하고, 이 throw는
  // defineApiRoute의 auth 해석 단계에서 잡혀 handler 실행 전에 403으로 반환된다(fail-closed).
  // 반환값을 무시하지 않고 명시적으로 검사해, 향후 이 함수가 throw 대신 falsy 반환형으로
  // 바뀌더라도 통과로 오인하지 않도록 방어한다(fail-open 회귀 차단).
  const adminProfile = await checkAdminPermission(db, user.id)
  if (!adminProfile) {
    throw new Error('관리자 권한이 필요합니다.')
  }

  return { db, user: { id: user.id } }
}

export function createSettingsAdminAuth(options: SettingsAdminAuthOptions = {}) {
  return () => requireSettingsAdmin(options)
}
