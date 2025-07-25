import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

// POST: 아티스트에 멤버 배정
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  try {
    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 확인
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session?.user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json(
        { error: '프로필 정보를 조회할 수 없습니다.' },
        { status: 500 }
      )
    }

    if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { error: '관리자 권한이 필요합니다.' },
        { status: 403 }
      )
    }

    // 요청 데이터 파싱
    const { memberId, role } = await request.json()
    const artistId = params.id

    if (!memberId || !role) {
      return NextResponse.json(
        { error: '멤버 ID와 역할이 필요합니다.' },
        { status: 400 }
      )
    }

    if (!['owner', 'manager', 'collaborator'].includes(role)) {
      return NextResponse.json(
        { error: '유효하지 않은 역할입니다.' },
        { status: 400 }
      )
    }

    // 대상 멤버 확인
    const { data: targetMember, error: memberError } = await supabase
      .from('member_profiles')
      .select('id, display_name, email, artist_id, artist_role')
      .eq('id', memberId)
      .eq('registration_status', 'approved')
      .eq('is_active', true)
      .single()

    if (memberError || !targetMember) {
      return NextResponse.json(
        { error: '멤버를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    // 이미 다른 아티스트에 배정되어 있는지 확인
    if (targetMember.artist_id && targetMember.artist_id !== artistId) {
      return NextResponse.json(
        { error: '이미 다른 아티스트에 배정된 멤버입니다.' },
        { status: 400 }
      )
    }

    // 아티스트 배정 업데이트
    const { data: updatedMember, error: updateError } = await supabase
      .from('member_profiles')
      .update({
        artist_id: artistId,
        artist_role: role,
        is_artist: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', memberId)
      .select()
      .single()

    if (updateError) {
      console.error('Member update error:', updateError)
      return NextResponse.json(
        { error: '아티스트 배정에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 성공 응답
    return NextResponse.json({
      success: true,
      message: `${targetMember.display_name}님이 아티스트로 배정되었습니다.`,
      member: updatedMember
    })

  } catch (error) {
    console.error('Admin artist assignment API error:', error)
    return NextResponse.json(
      { error: '아티스트 배정 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}