import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { toSafeInternalImagePath } from '@/utils/safeUrl'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

// 이 라우트는 의도적으로 `data/artists.json`(DB가 아님)을 계속 본다 — 판단
// 근거를 남긴다.
//
// `src/lib/data.ts:67-116`이 운영에서 금지한 "옛 명단 폴백"이 여기서는 여전히
// 살아 있는 게 맞다. `getArtists()`(DB 경로)로 바꾸면 두 가지가 함께 깨진다:
//  1) `getArtistsFromDB`는 운영에서 DB 조회 실패 시 JSON으로 조용히 되돌지
//     않고 **던진다**(B-1 재발 방지). 이 라우트는 소셜 크롤러가 두드리는
//     엔드포인트라 DB의 일시적 hiccup까지 500으로 바로 노출하는 건 이 API
//     하나의 스코프를 넘는 트레이드오프다.
//  2) DB 아티스트의 `profileImage`는 대부분 우리 Blob 저장소의 절대 URL이다.
//     아래 `toSafeInternalImagePath`는 내부 상대 경로만 통과시키므로(Blob
//     origin은 `https://ggac.local`과 다르다) Blob 사진을 가진 모든 아티스트가
//     조용히 기본 로고로 바뀐다 — `toSafeArtistImageSrc`로 함께 바꿔야 막을 수
//     있는데, 그러면 아래 "JPG 우선" 로컬 파일 존재 확인 로직까지 다시 설계해야
//     한다. 이 정리 작업의 스코프(정적 JSON 캐싱)를 넘어서므로 여기서는
//     동기 `fs.readFileSync`를 모듈 레벨 프로미스 메모로만 바꾼다 — DB 전환은
//     별도 작업으로 남긴다.
let artistsDataPromise: Promise<
  Array<{ slug: string; name: string; profileImage?: string }>
> | null = null
function loadArtistsData() {
  if (!artistsDataPromise) {
    artistsDataPromise = fs.promises
      .readFile(path.join(process.cwd(), 'data/artists.json'), 'utf8')
      .then(raw => JSON.parse(raw))
    artistsDataPromise.catch(() => {
      artistsDataPromise = null
    })
  }
  return artistsDataPromise
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const artistSlug = searchParams.get('artist')

    if (!artistSlug) {
      return createErrorResponse({ success: false, error: 'Artist slug is required' }, 400)
    }

    // 아티스트 데이터 로드 (모듈 레벨 메모 — 배포 내 불변인 정적 파일이라
    // 요청마다 다시 읽을 필요가 없다)
    const artistsData = await loadArtistsData()

    const artist = artistsData.find(a => a.slug === artistSlug)

    if (!artist) {
      return createErrorResponse({ success: false, error: 'Artist not found' }, 404)
    }

    // 베이스 URL 설정
    const baseUrl =
      process.env.NODE_ENV === 'production' ? 'https://ggac.kr' : 'http://localhost:3000'

    // 프로필 이미지 경로 (JPG 우선)
    let imagePath = toSafeInternalImagePath(artist.profileImage)
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
