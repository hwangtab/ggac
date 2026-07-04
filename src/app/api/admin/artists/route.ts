import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { getArtists } from '@/lib/data'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 아티스트 목록 및 배정 정보 조회
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/artists',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_artists'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () =>
    ApiError.internalServerError(
      '아티스트 정보를 조회하는 중 오류가 발생했습니다.'
    ).toNextResponse(),
  handler: async ({ auth }) => {
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

    return ApiSuccess.ok({ artists: artistsWithMembers })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
