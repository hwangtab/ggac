import { listGrantDigests } from '@/db/queries/grantDigests'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { ApiSuccess } from '@/utils/apiWrapper'

const LIST_LIMIT = 20

export const GET = defineApiRoute({
  method: 'GET',
  name: 'admin.grants.list',
  rateLimit: { ...RATE_LIMITS.ADMIN_API, keyGenerator: createUserKeyGenerator('admin_grants') },
  rateLimitHeaders: true,
  auth: 'admin',
  handler: async () => {
    const digests = await listGrantDigests(LIST_LIMIT)
    // 목록에는 항목 배열을 통째로 싣지 않는다 — 회차당 12건 × 20회차면 응답이 불필요하게 커진다.
    return ApiSuccess.ok({
      digests: digests.map(d => ({
        id: d.id,
        week_key: d.week_key,
        status: d.status,
        post_id: d.post_id,
        created_at: d.created_at,
        published_at: d.published_at,
        total_count: d.items.length,
        active_count: d.items.filter(i => !i.excluded).length,
      })),
    })
  },
})
