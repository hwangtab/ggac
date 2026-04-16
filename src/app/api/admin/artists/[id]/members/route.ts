export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

// POST: 아티스트에 멤버 배정
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params

  try {
    const supabase = await createSupabaseServer()

    // 사용자 인증 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
    }

    if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // 요청 데이터 파싱
    const { memberId, role } = await request.json()
    const artistId = resolvedParams.id

    // UUID 형식 검증
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!artistId || !uuidPattern.test(artistId)) {
      return NextResponse.json({ error: '유효하지 않은 아티스트 ID입니다.' }, { status: 400 })
    }
    if (!memberId || !uuidPattern.test(memberId)) {
      return NextResponse.json({ error: '유효하지 않은 멤버 ID입니다.' }, { status: 400 })
    }

    if (!role) {
      return NextResponse.json({ error: '역할이 필요합니다.' }, { status: 400 })
    }

    if (!['owner', 'manager', 'collaborator'].includes(role)) {
      return NextResponse.json({ error: '유효하지 않은 역할입니다.' }, { status: 400 })
    }

    // 대상 멤버 확인
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      console.error('[artists/members] SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.')
      return NextResponse.json({ error: '서버 구성 오류입니다.' }, { status: 500 })
    }
    const db = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: targetMember, error: memberError } = await db
      .from('member_profiles')
      .select('id, display_name, email, artist_id, artist_role')
      .eq('id', memberId)
      .eq('registration_status', 'approved')
      .eq('is_active', true)
      .single()

    if (memberError || !targetMember) {
      return NextResponse.json({ error: '멤버를 찾을 수 없습니다.' }, { status: 404 })
    }

    // 이미 다른 아티스트에 배정되어 있는지 확인
    if (targetMember.artist_id && targetMember.artist_id !== artistId) {
      return NextResponse.json(
        { error: '이미 다른 아티스트에 배정된 멤버입니다.' },
        { status: 400 }
      )
    }

    // 아티스트 배정 업데이트
    const { data: updatedMember, error: updateError } = await db
      .from('member_profiles')
      .update({
        artist_id: artistId,
        artist_role: role,
        is_artist: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberId)
      .select()
      .single()

    if (updateError) {
      console.error('Member update error:', updateError)
      return NextResponse.json({ error: '아티스트 배정에 실패했습니다.' }, { status: 500 })
    }

    // 성공 응답
    return NextResponse.json({
      success: true,
      message: `${targetMember.display_name}님이 아티스트로 배정되었습니다.`,
      member: updatedMember,
    })
  } catch (error) {
    console.error('Admin artist assignment API error:', error)

    // Supabase 관련 에러인지 확인
    if (error && typeof error === 'object' && 'message' in error) {
      const errorMessage = (error as { message: string }).message
      if (errorMessage.includes('Cannot find module')) {
        return NextResponse.json(
          { error: 'Supabase module loading error. Please try again.' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ error: '아티스트 배정 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
