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

export async function GET(request: NextRequest) {
  try {
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_posts_stats'),
    })
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const { db } = auth

    // Get total posts count
    const { count: totalPosts } = await db
      .from('posts')
      .select('id', { count: 'exact', head: true })

    // Get deleted posts count
    const { count: totalDeleted } = await db
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('is_deleted', true)

    // Get pinned posts count
    const { count: totalPinned } = await db
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('is_pinned', true)

    // Get category stats
    const { data: categoryData } = await db.from('posts').select('category').eq('is_deleted', false)

    const categoryStats = {
      공지: 0,
      잡담: 0,
      홍보: 0,
      건의: 0,
    }

    if (categoryData) {
      categoryData.forEach(post => {
        if (post.category in categoryStats) {
          categoryStats[post.category as keyof typeof categoryStats]++
        }
      })
    }

    const stats = {
      totalPosts: totalPosts || 0,
      totalDeleted: totalDeleted || 0,
      totalPinned: totalPinned || 0,
      categoryStats,
    }

    const response = NextResponse.json(stats)
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin posts stats API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
