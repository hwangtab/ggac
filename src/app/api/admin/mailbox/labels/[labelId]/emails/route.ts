import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { AdminAuthSuccess } from '@/lib/server/adminAuth'
import { labelExists, setLabelOnEmails } from '@/db/queries/mailboxLabels'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 한 번에 붙이거나 뗄 메일 수 상한 — 일괄 상태 변경과 같다(목록 한 페이지). */
const BULK_MAX = 100

// POST: 메일 여러 통에 라벨을 붙이거나(`action: 'add'`) 뗀다(`'remove'`) — 관리자만. 상세의 한 통도 이 경로다.
// 이미 붙은 메일에 다시 붙이면 그대로다(멱등). 없는 메일 id는 `missing`으로 돌려준다.
export const POST = defineApiRoute<{ email_ids?: unknown; action?: unknown }, AdminAuthSuccess>({
  method: 'POST',
  name: 'api/admin/mailbox/labels/[labelId]/emails',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('라벨을 붙이는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ body, params, auth }) => {
    const labelCheck = validateUUID(String(params.labelId ?? ''), '라벨 ID')
    if (!labelCheck.isValid) throw ApiError.badRequest('유효한 라벨 id가 필요합니다.')
    const action = body?.action
    if (action !== 'add' && action !== 'remove') throw ApiError.badRequest('알 수 없는 동작입니다.')
    const raw = body?.email_ids
    if (!Array.isArray(raw) || raw.length === 0) throw ApiError.badRequest('메일을 골라 주세요.')
    if (raw.length > BULK_MAX) throw ApiError.badRequest(`한 번에 ${BULK_MAX}건까지 가능합니다.`)
    const emailIds = raw.map(value => {
      const check = validateUUID(String(value ?? ''), '메일 ID')
      if (!check.isValid) throw ApiError.badRequest('메일 id가 올바르지 않습니다.')
      return check.sanitized
    })
    if (!(await labelExists(labelCheck.sanitized)))
      throw ApiError.notFound('라벨을 찾을 수 없습니다.')

    const outcome = await setLabelOnEmails({
      labelId: labelCheck.sanitized,
      emailIds,
      action,
      by: auth.user.id,
    })
    return ApiSuccess.ok({ label_id: labelCheck.sanitized, action, ...outcome })
  },
})
