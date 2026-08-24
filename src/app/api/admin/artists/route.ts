import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { getArtists } from '@/lib/data'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { listProfiles } from '@/db/queries/profiles'

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
  handler: async () => {
    // JSON 파일에서 아티스트 데이터 가져오기
    const artists = await getArtists()

    // 배정된 멤버 정보를 아티스트별로 개별 조회하던 것(N개 쿼리)을 프로필
    // 전체를 한 번만 조회해 메모리에서 아티스트별로 나누는 방식으로 바꿨다
    // (회원 23명 기준 listProfiles가 지원하는 status/search 필터로는 표현할
    // 수 없는 artist_id/is_artist/is_active 조합이라 배치 후 메모리 필터가
    // 최선이다 — getDirectorRoster/getAuditorRoster와 같은 패턴).
    let allProfiles: Awaited<ReturnType<typeof listProfiles>>['rows'] = []
    try {
      allProfiles = (await listProfiles({ limit: 10000, offset: 0 })).rows
    } catch (error) {
      console.error('Error fetching member profiles for artists list:', error)
    }

    const artistsWithMembers = artists.map(artist => {
      const assignedMembers = allProfiles
        .filter(
          profile => profile.artist_id === artist.id && profile.is_artist && profile.is_active
        )
        .map(profile => ({
          id: profile.id,
          display_name: profile.display_name,
          email: profile.email,
          artist_role: profile.artist_role,
        }))

      return {
        ...artist,
        assignedMembers,
      }
    })

    return ApiSuccess.ok({ artists: artistsWithMembers })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
