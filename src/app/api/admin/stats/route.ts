import { createOptionsResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { ApiSuccess } from '@/utils/apiWrapper'
import { getAdminMemberCounts } from '@/db/queries/profiles'
import { countActivePosts } from '@/db/queries/posts'

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
  handler: async () => {
    // Task 8: member_profiles/posts count 4개를 Supabase에서 Turso 쿼리
    // 계층(getAdminMemberCounts/countActivePosts)으로 옮겼다 — count만
    // 필요하므로 행 전송 없이 집계 쿼리만 실행한다(전수감사 API High 4가
    // 지적한 전행 다운로드 문제를 그대로 계승하지 않는다).
    const [memberCounts, totalPosts] = await Promise.all([
      getAdminMemberCounts(),
      countActivePosts(),
    ])

    const stats = {
      totalMembers: memberCounts.totalMembers,
      pendingApprovals: memberCounts.pendingMembers,
      totalPosts,
      activeArtists: memberCounts.activeArtists,
    }

    return ApiSuccess.ok(stats)
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
