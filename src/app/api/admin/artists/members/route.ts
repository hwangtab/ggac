import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { listProfiles, ALL_PROFILES_LIMIT } from '@/db/queries/profiles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 아티스트 권한 관리 가능한 멤버 목록 조회
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/artists/members',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_artists_members'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () =>
    ApiError.internalServerError('멤버 정보를 조회하는 중 오류가 발생했습니다.').toNextResponse(),
  handler: async () => {
    // 승인된 모든 멤버 조회 (아티스트 권한 부여 대상)
    let rows: Awaited<ReturnType<typeof listProfiles>>['rows']
    try {
      ;({ rows } = await listProfiles({ status: 'approved', limit: ALL_PROFILES_LIMIT, offset: 0 }))
    } catch (error) {
      console.error('Members fetch error:', error)
      throw ApiError.internalServerError('멤버 정보를 조회하는 중 오류가 발생했습니다.')
    }

    // 정렬은 기존 `.order('display_name', { ascending: true })`와 동일하게
    // 이름 오름차순으로 고정한다 — listProfiles 자체는 created_at 내림차순만
    // 지원한다(getDirectorRoster/getAuditorRoster와 같은 패턴).
    const members = rows
      .filter(row => row.is_active)
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'ko'))
      .map(row => ({
        id: row.id,
        display_name: row.display_name,
        email: row.email,
        is_artist: row.is_artist,
        artist_id: row.artist_id,
        artist_role: row.artist_role,
      }))

    return ApiSuccess.ok({ members })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
