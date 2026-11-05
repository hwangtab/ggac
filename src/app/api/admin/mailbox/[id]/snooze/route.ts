import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { AdminAuthSuccess } from '@/lib/server/adminAuth'
import { setInboundSnooze } from '@/db/queries/mailbox'
import { checkSnoozeUntil } from '@/lib/mail/snooze'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH: 다시 알림 걸기(`until`: ISO 시각)·풀기(`until: null`) — 관리자만(상태 변경과 같은 등급).
// 시각은 30분 뒤 ~ 1년 안. 지나면 메일함 크론(매시)이 안 읽음으로 되돌리고 담당자(없으면 건 사람)에게 푸시한다.
export const PATCH = defineApiRoute<{ until?: unknown }, AdminAuthSuccess>({
  method: 'PATCH',
  name: 'api/admin/mailbox/[id]/snooze',
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
    return ApiError.internalServerError('다시 알림을 바꾸지 못했습니다.').toNextResponse()
  },
  handler: async ({ body, params, auth }) => {
    const idCheck = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idCheck.isValid) throw ApiError.badRequest('유효한 id가 필요합니다.')
    let until: Date | null = null
    if (body?.until !== null && body?.until !== undefined) {
      until = typeof body.until === 'string' ? new Date(body.until) : new Date(NaN)
      const check = checkSnoozeUntil(until)
      if (check.ok === false) throw ApiError.badRequest(check.error)
    }
    const outcome = await setInboundSnooze({ id: idCheck.sanitized, until, by: auth.user.id })
    if (outcome === 'missing') throw ApiError.notFound('메일을 찾을 수 없습니다.')
    return ApiSuccess.ok({
      id: idCheck.sanitized,
      snoozed_until: until ? until.toISOString() : null,
    })
  },
})
