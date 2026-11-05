import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { logSecurityEvent } from '@/utils/security'
import { parseIntegerParam } from '@/utils/queryParams'
import { listInboundEmails } from '@/db/queries/mailbox'
import { normalizeSenderDomain, parseMailbox } from '@/lib/mail/senderAddress'
import { DAY_MS, parseSeoulDay } from '@/lib/mail/seoulDay'

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

    // 발신자 필터. `홍길동 <a@b>`를 붙여 넣어도 주소만 본다. 254자는 주소 길이 상한(RFC 5321).
    const fromParam = params.get('from')?.trim()
    const fromEmail = fromParam ? parseMailbox(fromParam.slice(0, 320)).email : ''
    if (fromParam && (!fromEmail || fromEmail.length > 254)) {
      throw ApiError.badRequest('보낸 사람 주소가 올바르지 않습니다.')
    }
    const domainParam = params.get('domain')?.trim()
    const fromDomain = domainParam ? normalizeSenderDomain(domainParam) : null
    if (domainParam && !fromDomain) {
      throw ApiError.badRequest('도메인이 올바르지 않습니다.')
    }

    // 기간: `after`는 그날부터, `before`는 그날까지(포함) — 쿼리는 배타 상한이라 다음 날 0시를 넘긴다.
    const afterParam = params.get('after')
    const beforeParam = params.get('before')
    const receivedFrom = afterParam ? parseSeoulDay(afterParam) : null
    const beforeDay = beforeParam ? parseSeoulDay(beforeParam) : null
    if ((afterParam && !receivedFrom) || (beforeParam && !beforeDay)) {
      throw ApiError.badRequest('날짜는 YYYY-MM-DD 형식이어야 합니다.')
    }
    const receivedUntil = beforeDay ? new Date(beforeDay.getTime() + DAY_MS) : null
    if (receivedFrom && receivedUntil && receivedFrom >= receivedUntil) {
      throw ApiError.badRequest('시작일이 종료일보다 늦습니다.')
    }

    const has = params.get('has')
    if (has && has !== 'attachment') {
      throw ApiError.badRequest('알 수 없는 조건입니다.')
    }

    const result = await listInboundEmails({
      status: status ?? undefined,
      search,
      limit,
      offset,
      fromEmail: fromEmail || undefined,
      fromDomain: fromDomain ?? undefined,
      hasAttachment: has === 'attachment',
      receivedFrom: receivedFrom ?? undefined,
      receivedUntil: receivedUntil ?? undefined,
    })
    return ApiSuccess.ok({
      emails: result.emails,
      pagination: { total_count: result.total_count, limit, offset },
      can_manage: auth.isAdmin,
    })
  },
})
