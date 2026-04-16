import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/adminAuth'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 관리자 대시보드 통계 조회
export async function GET(request: NextRequest) {
  try {
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_stats'),
    })
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
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

    const response = NextResponse.json(stats)
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin stats API error:', error)
    return NextResponse.json(
      { error: '통계 정보를 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
