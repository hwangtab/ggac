import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { getAdminPostStats } from '@/db/queries/posts'

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
  errorResponse: () => ApiError.internalServerError('Internal server error').toNextResponse(),
  handler: async () => {
    // Task 8: 4개 Supabase count 쿼리(전체/삭제/고정/카테고리별)를
    // getAdminPostStats(src/db/queries/posts.ts)로 옮겼다 — 카테고리별
    // 집계는 GROUP BY 단일 쿼리(원본은 is_deleted=false 행 전체를 내려받아
    // JS에서 세었다).
    const stats = await getAdminPostStats()

    return ApiSuccess.ok(stats)
  },
})
