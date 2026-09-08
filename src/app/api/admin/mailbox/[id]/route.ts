import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { logSecurityEvent } from '@/utils/security'
import { getInboundEmail, listAttachmentsForEmail, updateInboundStatus } from '@/db/queries/mailbox'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_STATUSES = ['unread', 'read', 'replied', 'archived', 'spam'] as const

// GET: 메일 한 건 상세 + 첨부 목록 (이사·감사·관리자, 브리프 A)
export const GET = defineApiRoute<undefined, BoardAuthSuccess>({
  method: 'GET',
  name: 'api/admin/mailbox/[id]',
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
  handler: async ({ params, auth }) => {
    const idValidation = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idValidation.isValid) {
      throw ApiError.badRequest('유효한 id가 필요합니다.')
    }
    const id = idValidation.sanitized

    const email = await getInboundEmail(id)
    if (!email) {
      throw ApiError.notFound('메일을 찾을 수 없습니다.')
    }

    const attachments = await listAttachmentsForEmail(id)
    return ApiSuccess.ok({ email, attachments, can_manage: auth.isAdmin })
  },
})

// PATCH: 낙관적 동시성으로 상태 변경
export const PATCH = defineApiRoute<{ status?: string; expected_status?: string }>({
  method: 'PATCH',
  name: 'api/admin/mailbox/[id]',
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
  handler: async ({ body, params }) => {
    const idValidation = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idValidation.isValid) {
      throw ApiError.badRequest('유효한 id가 필요합니다.')
    }
    const id = idValidation.sanitized
    const next = String(body?.status ?? '')
    const expected = String(body?.expected_status ?? '')
    if (!ALLOWED_STATUSES.includes(next as (typeof ALLOWED_STATUSES)[number])) {
      throw ApiError.badRequest('알 수 없는 상태입니다.')
    }

    const outcome = await updateInboundStatus(id, expected, next)
    if (outcome === 'missing') {
      throw ApiError.notFound('메일을 찾을 수 없습니다.')
    }
    if (outcome === 'conflict') {
      // 다른 관리자가 먼저 바꿨다. 화면이 재조회하도록 409로 알린다.
      return ApiError.conflict('다른 곳에서 이미 상태가 바뀌었습니다.').toNextResponse()
    }
    return ApiSuccess.ok({ id, status: next })
  },
})
