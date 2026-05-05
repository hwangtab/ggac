import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/adminAuth'
import { getArtists } from '@/lib/data'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 아티스트 목록 및 배정 정보 조회
export async function GET(request: NextRequest) {
  try {
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_artists'),
    })
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const { db } = auth

    // JSON 파일에서 아티스트 데이터 가져오기
    const artists = await getArtists()

    // 각 아티스트에 대해 배정된 멤버 정보 조회
    const artistsWithMembers = await Promise.all(
      artists.map(async artist => {
        const { data: assignedMembers, error } = await db
          .from('member_profiles')
          .select('id, display_name, email, artist_role')
          .eq('artist_id', artist.id)
          .eq('is_artist', true)
          .eq('is_active', true)

        if (error) {
          console.error(`Error fetching members for artist ${artist.id}:`, error)
          return {
            ...artist,
            assignedMembers: [],
          }
        }

        return {
          ...artist,
          assignedMembers: assignedMembers || [],
        }
      })
    )

    const response = NextResponse.json({
      artists: artistsWithMembers,
    })
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin artists API error:', error)
    return NextResponse.json(
      { error: '아티스트 정보를 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
