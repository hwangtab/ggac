import { createOptionsResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { ApiSuccess } from '@/utils/apiWrapper'

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

    // count만 필요하므로 head:true로 행 전송을 없앤다 — 기존에는 posts 전체
    // (본문 포함)와 아티스트 프로필 전행을 실제로 전송하면서 count만 사용해
    // 대시보드 진입마다 수 MB를 옮겼다(전수감사 API High 4).
    const [membersResult, pendingResult, postsResult, artistsResult] = await Promise.all([
      db.from('member_profiles').select('id', { count: 'exact', head: true }),
      db
        .from('member_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('registration_status', 'pending'),
      db.from('posts').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
      db
        .from('member_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_artist', true)
        .eq('is_active', true),
    ])

    const totalMembers = membersResult.count || 0
    const pendingMembers = pendingResult.count || 0
    const totalPosts = postsResult.count || 0
    const activeArtists = artistsResult.count || 0

    const stats = {
      totalMembers,
      pendingApprovals: pendingMembers,
      totalPosts,
      activeArtists,
    }

    return ApiSuccess.ok(stats)
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
