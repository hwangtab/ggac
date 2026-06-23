import { createErrorResponse } from '@/utils/apiResponse'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/posts/stats',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_posts_stats'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () => createErrorResponse({ success: false, error: 'Internal server error' }, 500),
  handler: async ({ auth }) => {
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

    return stats
  },
})
