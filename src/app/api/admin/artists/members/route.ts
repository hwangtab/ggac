import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'

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
  handler: async ({ auth }) => {
    const { db } = auth

    // 승인된 모든 멤버 조회 (아티스트 권한 부여 대상)
    const { data: members, error: membersError } = await db
      .from('member_profiles')
      .select('id, display_name, email, is_artist, artist_id, artist_role')
      .eq('registration_status', 'approved')
      .eq('is_active', true)
      .order('display_name', { ascending: true })

    if (membersError) {
      console.error('Members fetch error:', membersError)
      throw ApiError.internalServerError('멤버 정보를 조회하는 중 오류가 발생했습니다.')
    }

    return ApiSuccess.ok({ members: members || [] })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
