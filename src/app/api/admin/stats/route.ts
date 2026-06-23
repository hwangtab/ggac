import { createOptionsResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 관리자 대시보드 통계 조회
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/stats',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_stats'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () =>
    NextResponse.json({ error: '통계 정보를 조회하는 중 오류가 발생했습니다.' }, { status: 500 }),
  handler: async ({ auth }) => {
    const { db } = auth

    const [membersResult, postsResult, artistsResult] = await Promise.all([
      db.from('member_profiles').select('registration_status', { count: 'exact' }),
      db.from('posts').select('*', { count: 'exact' }).eq('is_deleted', false),
      db
        .from('member_profiles')
        .select('*', { count: 'exact' })
        .eq('is_artist', true)
        .eq('is_active', true),
    ])

    const totalMembers = membersResult.count || 0
    const pendingMembers =
      membersResult.data?.filter(member => member.registration_status === 'pending').length || 0
    const totalPosts = postsResult.count || 0
    const activeArtists = artistsResult.count || 0

    const stats = {
      totalMembers,
      pendingApprovals: pendingMembers,
      totalPosts,
      activeArtists,
    }

    return stats
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
