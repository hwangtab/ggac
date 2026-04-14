export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

// DELETE: 아티스트 배정 해제
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; memberId: string }> }
) {
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

    const artistId = resolvedParams.id
    const memberId = resolvedParams.memberId

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const db =
      url && serviceKey
        ? createClient(url, serviceKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
        : supabase

    // 대상 멤버 확인
    const { data: targetMember, error: memberError } = await db
      .from('member_profiles')
      .select('id, display_name, email, artist_id, artist_role')
      .eq('id', memberId)
      .single()

    if (memberError || !targetMember) {
      return NextResponse.json({ error: '멤버를 찾을 수 없습니다.' }, { status: 404 })
    }

    // 해당 아티스트에 배정된 멤버인지 확인
    if (targetMember.artist_id !== artistId) {
      return NextResponse.json(
        { error: '해당 아티스트에 배정된 멤버가 아닙니다.' },
        { status: 400 }
      )
    }

    // 아티스트 배정 해제
    const { data: updatedMember, error: updateError } = await db
      .from('member_profiles')
      .update({
        artist_id: null,
        artist_role: null,
        is_artist: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberId)
      .select()
      .single()

    if (updateError) {
      console.error('Member update error:', updateError)
      return NextResponse.json({ error: '아티스트 배정 해제에 실패했습니다.' }, { status: 500 })
    }

    // 성공 응답
    return NextResponse.json({
      success: true,
      message: `${targetMember.display_name}님의 아티스트 배정이 해제되었습니다.`,
      member: updatedMember,
    })
  } catch (error) {
    console.error('Admin artist unassignment API error:', error)
    return NextResponse.json(
      { error: '아티스트 배정 해제 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
