import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { getArtists } from '@/lib/data'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { listProfiles, ALL_PROFILES_LIMIT } from '@/db/queries/profiles'

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
    //
    // 조회 실패를 삼키고 빈 배열로 진행하면 200 + 모든 아티스트
    // assignedMembers: []가 나가, 관리자 화면이 "배정된 회원 전원이 사라진
    // 화면"을 에러 배너 없이 진짜 데이터로 보여준다(filter==='unassigned'가
    // 전체 아티스트를 잡는 등). 형제 라우트 admin/artists/members/route.ts는
    // 이미 같은 실패를 throw로 다룬다 — 여기도 맞춘다.
    let allProfiles: Awaited<ReturnType<typeof listProfiles>>['rows']
    try {
      allProfiles = (await listProfiles({ limit: ALL_PROFILES_LIMIT, offset: 0 })).rows
    } catch (error) {
      console.error('Error fetching member profiles for artists list:', error)
      throw ApiError.internalServerError('아티스트 정보를 조회하는 중 오류가 발생했습니다.')
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
