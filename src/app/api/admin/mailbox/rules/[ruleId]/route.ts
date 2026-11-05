import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { deleteRule } from '@/db/queries/mailboxRules'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// DELETE: 발신자 규칙 지우기 — 관리자만. 이미 처리된 메일의 상태·라벨은 그대로 둔다(되돌리지 않는다).
export const DELETE = defineApiRoute({
  method: 'DELETE',
  name: 'api/admin/mailbox/rules/[ruleId]',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  auth: 'admin',
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('규칙을 지우지 못했습니다.').toNextResponse()
  },
  handler: async ({ params }) => {
    const check = validateUUID(String(params.ruleId ?? ''), '규칙 ID')
    if (!check.isValid) throw ApiError.badRequest('유효한 규칙 id가 필요합니다.')
    if (!(await deleteRule(check.sanitized))) throw ApiError.notFound('규칙을 찾을 수 없습니다.')
    return ApiSuccess.ok({ id: check.sanitized, deleted: true })
  },
})
