import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const artistSlug = searchParams.get('artist')

    if (!artistSlug) {
      return createErrorResponse({ success: false, error: 'Artist slug is required' }, 400)
    }

    // 아티스트 데이터 로드
    const artistsData = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
    )

    const artist = artistsData.find((a: any) => a.slug === artistSlug)

    if (!artist) {
      return createErrorResponse({ success: false, error: 'Artist not found' }, 404)
    }

    // 베이스 URL 설정
    const baseUrl =
      process.env.NODE_ENV === 'production' ? 'https://ggac.kr' : 'http://localhost:3000'

    // 프로필 이미지 경로 (JPG 우선)
    let imagePath = artist.profileImage
    if (imagePath.endsWith('.webp')) {
      const jpgPath = imagePath.replace('.webp', '.jpg')
      const jpgFullPath = path.join(process.cwd(), 'public', jpgPath)
      if (fs.existsSync(jpgFullPath)) {
        imagePath = jpgPath
      }
    }

    const imageUrl = `${baseUrl}${imagePath}`

    // 간단한 JSON 응답으로 이미지 URL 반환
    // 실제 이미지는 아티스트 페이지에서 직접 사용
    return NextResponse.json(
      {
        success: true,
        artist: artist.name,
        imageUrl: imageUrl,
        message: 'Using direct image URL for better compatibility',
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  } catch (error) {
    console.error('OG Image API error:', error)

    return NextResponse.json(
      {
        error: '요청 처리에 실패했습니다.',
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'public, max-age=3600',
        },
      }
    )
  }
}
