import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { logSecurityEvent } from '@/utils/security'
import { parseIntegerParam } from '@/utils/queryParams'
import { listInboundEmails } from '@/db/queries/mailbox'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_STATUSES = ['unread', 'read', 'replied', 'archived', 'spam'] as const

// GET: 이사·감사·관리자 메일함 목록 조회 (브리프 A)
export const GET = defineApiRoute<undefined, BoardAuthSuccess>({
  method: 'GET',
  name: 'api/admin/mailbox',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  rateLimitHeaders: true,
  auth: 'board-member',
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('메일을 조회하는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ request, auth }) => {
    const params = request.nextUrl.searchParams
    const status = params.get('status')
    const search = params.get('search')?.slice(0, 100) ?? undefined
    const limit = parseIntegerParam(params.get('limit'), 30, { min: 1, max: 100 })
    const offset = parseIntegerParam(params.get('offset'), 0, { min: 0, max: 100000 })

    if (status && !ALLOWED_STATUSES.includes(status as (typeof ALLOWED_STATUSES)[number])) {
      throw ApiError.badRequest('알 수 없는 상태입니다.')
    }

    const result = await listInboundEmails({ status: status ?? undefined, search, limit, offset })
    return ApiSuccess.ok({
      emails: result.emails,
      pagination: { total_count: result.total_count, limit, offset },
      can_manage: auth.isAdmin,
    })
  },
})
