import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { logSecurityEvent } from '@/utils/security'
import { parseIntegerParam } from '@/utils/queryParams'
import { listInboundEmails, updateInboundStatusBulk } from '@/db/queries/mailbox'
import { validateUUID } from '@/utils/validation'
import { normalizeSenderDomain, parseMailbox } from '@/lib/mail/senderAddress'
import { DAY_MS, parseSeoulDay } from '@/lib/mail/seoulDay'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_STATUSES = ['unread', 'read', 'replied', 'archived', 'spam'] as const
/** 일괄 변경 상한 — 목록 한 페이지(최대 100건)를 넘지 않는다. */
const BULK_MAX = 100

type BulkBody = { status?: unknown; items?: unknown }

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

    // "내 담당" — 지금 로그인한 사람이 담당자인 메일. 다른 사람의 id로 거르는 것은 열지 않는다(필요 없다).
    const assignee = params.get('assignee')
    if (assignee && assignee !== 'me') {
      throw ApiError.badRequest('알 수 없는 담당자 조건입니다.')
    }

    const labelParam = params.get('label')
    const labelCheck = labelParam ? validateUUID(labelParam, '라벨 ID') : null
    if (labelCheck && !labelCheck.isValid) throw ApiError.badRequest('라벨 id가 올바르지 않습니다.')

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
      assignedTo: assignee === 'me' ? auth.user.id : undefined,
      labelId: labelCheck?.sanitized,
    })
    return ApiSuccess.ok({
      emails: result.emails,
      pagination: { total_count: result.total_count, limit, offset },
      can_manage: auth.isAdmin,
    })
  },
})

// PATCH: 여러 메일의 상태를 한 번에 바꾼다(관리자만). 메일마다 화면이 알던 상태(`expected_status`)를 함께 받아
// 단건 PATCH와 같은 낙관적 동시성을 지킨다 — 다른 관리자가 먼저 바꾼 메일은 건드리지 않고 `conflict`로 돌려준다.
// 일부만 바뀌어도 200이다(무엇이 바뀌었는지는 본문이 말한다). 전부 검증한 뒤에만 쓴다.
export const PATCH = defineApiRoute<BulkBody>({
  method: 'PATCH',
  name: 'api/admin/mailbox',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('상태를 변경하는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ body }) => {
    const next = String(body?.status ?? '')
    if (!ALLOWED_STATUSES.includes(next as (typeof ALLOWED_STATUSES)[number])) {
      throw ApiError.badRequest('알 수 없는 상태입니다.')
    }
    const rawItems = body?.items
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw ApiError.badRequest('바꿀 메일을 골라 주세요.')
    }
    if (rawItems.length > BULK_MAX) {
      throw ApiError.badRequest(`한 번에 ${BULK_MAX}건까지 바꿀 수 있습니다.`)
    }
    const seen = new Set<string>()
    const items: { id: string; expected: string }[] = []
    for (const raw of rawItems) {
      const record = (raw ?? {}) as { id?: unknown; expected_status?: unknown }
      const idCheck = validateUUID(String(record.id ?? ''), '메일 ID')
      const expected = String(record.expected_status ?? '')
      if (
        !idCheck.isValid ||
        !ALLOWED_STATUSES.includes(expected as (typeof ALLOWED_STATUSES)[number])
      ) {
        throw ApiError.badRequest('메일 id 또는 기대 상태가 올바르지 않습니다.')
      }
      if (seen.has(idCheck.sanitized)) continue
      seen.add(idCheck.sanitized)
      items.push({ id: idCheck.sanitized, expected })
    }

    const outcome = await updateInboundStatusBulk(items, next)
    return ApiSuccess.ok({ status: next, ...outcome })
  },
})
