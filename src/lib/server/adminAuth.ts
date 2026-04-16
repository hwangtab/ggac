import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export type AdminAuthSuccess = {
  db: SupabaseClient
  user: { id: string }
}

/**
 * 관리자 인증 및 서비스 롤 클라이언트 생성을 한 번에 처리하는 공유 유틸리티.
 *
 * - 미인증: 401 NextResponse 반환
 * - 프로필 조회 실패: 500 NextResponse 반환
 * - is_admin false / registration_status != 'approved' / is_active false: 403 NextResponse 반환
 * - SUPABASE_SERVICE_ROLE_KEY 없음: 500 NextResponse 반환 (무음 폴백 방지)
 *
 * 사용 예:
 *   const auth = await requireAdmin()
 *   if (auth instanceof NextResponse) return auth
 *   const { db } = auth
 */
export async function requireAdmin(): Promise<AdminAuthSuccess | NextResponse> {
  const supabase = await createSupabaseServer()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('member_profiles')
    .select('is_admin, registration_status, is_active')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
  }

  if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error(
      '[adminAuth] SUPABASE_SERVICE_ROLE_KEY 또는 NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.'
    )
    return NextResponse.json({ error: '서버 구성 오류입니다.' }, { status: 500 })
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return { db, user }
}

/**
 * settings 라우트들에서 사용하는 throw 방식 헬퍼 (기존 패턴 유지).
 * 새 라우트는 requireAdmin()을 사용할 것.
 */
export async function checkAdminPermission(supabase: SupabaseClient, userId: string) {
  const { data: profile, error } = await supabase
    .from('member_profiles')
    .select('is_admin, registration_status, is_active')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    throw new Error('프로필 정보를 조회할 수 없습니다.')
  }

  if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
    throw new Error('관리자 권한이 필요합니다.')
  }

  return profile
}
