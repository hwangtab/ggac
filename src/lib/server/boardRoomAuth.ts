import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createLogger } from '@/utils/logger'

const log = createLogger('boardRoomAuth')

export type BoardAuthSuccess = {
  db: SupabaseClient
  user: { id: string }
  isAdmin: boolean
}

/**
 * 이사회 전용 API 권한 헬퍼.
 * - 미인증: 401
 * - 프로필 조회 실패: 500
 * - (is_director=false AND is_admin=false) / 미승인 / 비활성: 403
 * - service-role 키 없음: 500
 * 성공 시 service-role db 클라이언트와 user, isAdmin 반환.
 */
export async function requireBoardMember(): Promise<BoardAuthSuccess | NextResponse> {
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
    .select('is_admin, is_director, registration_status, is_active')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
  }

  if (
    profile.registration_status !== 'approved' ||
    !profile.is_active ||
    (!profile.is_director && !profile.is_admin)
  ) {
    return NextResponse.json({ error: '이사회 접근 권한이 없습니다.' }, { status: 403 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    log.error('SUPABASE_SERVICE_ROLE_KEY 또는 URL 미설정')
    return NextResponse.json({ error: '서버 구성 오류입니다.' }, { status: 500 })
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return { db, user, isAdmin: !!profile.is_admin }
}

/** 관리자 전용 동작(회의 생성·확정·출석 체크 등) 가드 */
export function requireBoardAdmin(auth: BoardAuthSuccess): NextResponse | null {
  if (!auth.isAdmin) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }
  return null
}

/** 재적 이사 명단(승인·활성 + is_director) */
export async function getDirectorRoster(db: SupabaseClient) {
  const { data, error } = await db
    .from('member_profiles')
    .select('id, display_name, director_title')
    .eq('is_director', true)
    .eq('is_active', true)
    .eq('registration_status', 'approved')
  if (error) throw error
  return data ?? []
}
