import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 아티스트 업데이트 스키마 정의
const ArtistUpdateSchema = z.object({
  name: z.string().min(1, '아티스트 이름은 필수입니다.').max(100, '아티스트 이름은 100자 이내여야 합니다.'),
  category: z.array(z.string()).min(1, '최소 하나의 카테고리를 선택해주세요.'),
  one_liner: z.string().min(1, '한 줄 소개는 필수입니다.').max(100, '한 줄 소개는 100자 이내여야 합니다.'),
  bio: z.string().min(1, '아티스트 소개는 필수입니다.').max(5000, '아티스트 소개는 5000자 이내여야 합니다.'),
  template_type: z.enum(['미니멀형', '콜라주형']),
  profile_photo_url: z.string().nullable().optional(),
  profile_photo_metadata: z.object({
    original_filename: z.string().optional(),
    file_size: z.number().optional(),
    content_type: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    uploaded_at: z.string().optional(),
    processed: z.boolean().optional(),
    versions: z.object({
      thumbnail: z.string().optional(),
      medium: z.string().optional(),
      large: z.string().optional()
    }).optional(),
    crop_info: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number()
    }).optional()
  }).optional(),
  portfolio_links: z.array(z.object({
    title: z.string(),
    url: z.string().url('올바른 URL 형식을 입력해주세요.')
  })).optional(),
  youtube_videos: z.array(z.object({
    title: z.string(),
    url: z.string().url('올바른 YouTube URL을 입력해주세요.')
  })).optional(),
  contact: z.string().email('올바른 이메일 형식을 입력해주세요.').optional().or(z.literal(''))
})

// GET: 현재 사용자의 아티스트 정보 조회
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

    // 사용자의 프로필 정보 조회 (아티스트 ID 확인)
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('artist_id, is_artist, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json(
        { error: '프로필 정보를 조회할 수 없습니다.' },
        { status: 500 }
      )
    }

    // 아티스트 권한 확인
    if (!profile.is_artist || !profile.artist_id) {
      return NextResponse.json(
        { error: '아티스트 권한이 없습니다.' },
        { status: 403 }
      )
    }

    if (profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { error: '승인된 멤버만 접근할 수 있습니다.' },
        { status: 403 }
      )
    }

    // 아티스트 정보 조회
    const { data: artist, error: artistError } = await supabase
      .from('artists')
      .select('*')
      .eq('legacy_id', profile.artist_id)
      .single()

    if (artistError) {
      console.error('Artist fetch error:', artistError)
      return NextResponse.json(
        { error: '아티스트 정보를 조회할 수 없습니다.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ artist })

  } catch (error) {
    console.error('Artist GET error:', error)
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// PATCH: 아티스트 정보 업데이트
export async function PATCH(request: NextRequest) {
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

    // 요청 데이터 파싱 및 검증
    const body = await request.json()
    
    const validationResult = ArtistUpdateSchema.safeParse(body)
    if (!validationResult.success) {
      const errors = validationResult.error.issues.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }))
      
      return NextResponse.json(
        { error: '입력 데이터가 올바르지 않습니다.', details: errors },
        { status: 400 }
      )
    }

    const updateData = validationResult.data

    // 사용자의 프로필 정보 조회 (아티스트 ID 확인)
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('artist_id, is_artist, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json(
        { error: '프로필 정보를 조회할 수 없습니다.' },
        { status: 500 }
      )
    }

    // 아티스트 권한 확인
    if (!profile.is_artist || !profile.artist_id) {
      return NextResponse.json(
        { error: '아티스트 권한이 없습니다.' },
        { status: 403 }
      )
    }

    if (profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { error: '승인된 멤버만 접근할 수 있습니다.' },
        { status: 403 }
      )
    }

    // 포트폴리오 링크 유효성 검사
    if (updateData.portfolio_links) {
      for (const link of updateData.portfolio_links) {
        if (link.url && !/^https?:\/\/.+/.test(link.url)) {
          return NextResponse.json(
            { error: '포트폴리오 링크는 올바른 URL 형식이어야 합니다.' },
            { status: 400 }
          )
        }
      }
    }

    // 유튜브 동영상 유효성 검사
    if (updateData.youtube_videos) {
      for (const video of updateData.youtube_videos) {
        if (video.url && !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/.test(video.url)) {
          return NextResponse.json(
            { error: '유튜브 동영상은 올바른 YouTube URL이어야 합니다.' },
            { status: 400 }
          )
        }
      }
    }

    // 연락처 정리 (빈 문자열을 null로 변환)
    const contactValue = updateData.contact === '' ? null : updateData.contact

    // 아티스트 정보 업데이트
    const { data: updatedArtist, error: updateError } = await supabase
      .from('artists')
      .update({
        name: updateData.name,
        category: updateData.category,
        one_liner: updateData.one_liner,
        bio: updateData.bio,
        template_type: updateData.template_type,
        profile_photo_url: updateData.profile_photo_url,
        profile_photo_metadata: updateData.profile_photo_metadata,
        portfolio_links: updateData.portfolio_links || [],
        youtube_videos: updateData.youtube_videos || [],
        contact: contactValue,
        updated_at: new Date().toISOString()
      })
      .eq('legacy_id', profile.artist_id)
      .select()
      .single()

    if (updateError) {
      console.error('Artist update error:', updateError)
      return NextResponse.json(
        { error: '아티스트 정보 업데이트에 실패했습니다.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      message: '아티스트 정보가 성공적으로 업데이트되었습니다.',
      artist: updatedArtist 
    })

  } catch (error) {
    console.error('Artist PATCH error:', error)
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
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
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}