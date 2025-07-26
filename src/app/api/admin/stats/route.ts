import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 관리자 대시보드 통계 조회
export async function GET(request: NextRequest) {
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

    // 통계 데이터 수집
    const [membersResult, postsResult, artistsResult] = await Promise.all([
      // 전체 회원 수 및 승인 대기 회원 수
      supabase
        .from('member_profiles')
        .select('registration_status', { count: 'exact' }),
      
      // 전체 게시글 수
      supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .eq('is_deleted', false),
      
      // 활성 아티스트 수
      supabase
        .from('member_profiles')
        .select('*', { count: 'exact' })
        .eq('is_artist', true)
        .eq('is_active', true)
    ])

    // 전체 회원 수
    const totalMembers = membersResult.count || 0
    
    // 승인 대기 회원 수
    const pendingMembers = membersResult.data?.filter(
      member => member.registration_status === 'pending'
    ).length || 0
    
    // 전체 게시글 수
    const totalPosts = postsResult.count || 0
    
    // 활성 아티스트 수
    const activeArtists = artistsResult.count || 0

    const stats = {
      totalMembers,
      pendingApprovals: pendingMembers,
      totalPosts,
      activeArtists
    }

    return NextResponse.json(stats)

  } catch (error) {
    console.error('Admin stats API error:', error)
    return NextResponse.json(
      { error: '통계 정보를 조회하는 중 오류가 발생했습니다.' },
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}