import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { getArtists } from '@/lib/data'

// GET: 아티스트 목록 및 배정 정보 조회
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

    // JSON 파일에서 아티스트 데이터 가져오기
    const artists = await getArtists()

    // 각 아티스트에 대해 배정된 멤버 정보 조회
    const artistsWithMembers = await Promise.all(
      artists.map(async (artist) => {
        const { data: assignedMembers, error } = await supabase
          .from('member_profiles')
          .select('id, display_name, email, artist_role')
          .eq('artist_id', artist.id)
          .eq('is_artist', true)
          .eq('is_active', true)

        if (error) {
          console.error(`Error fetching members for artist ${artist.id}:`, error)
          return {
            ...artist,
            assignedMembers: []
          }
        }

        return {
          ...artist,
          assignedMembers: assignedMembers || []
        }
      })
    )

    return NextResponse.json({
      artists: artistsWithMembers
    })

  } catch (error) {
    console.error('Admin artists API error:', error)
    return NextResponse.json(
      { error: '아티스트 정보를 조회하는 중 오류가 발생했습니다.' },
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