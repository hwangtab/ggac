import { after } from 'next/server'

import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { canAccessBoardRoom } from '@/lib/server/authz'
import { getInboundEmail, setInboundAssignee } from '@/db/queries/mailbox'
import { getDisplayNames, getWorkPeople } from '@/db/queries/work/directory'
import { buildAssignmentPush } from '@/lib/mail/assigneePush'
import { sendPushToUsers } from '@work/lib/push/send'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function readOptionalId(raw: unknown, label: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const check = validateUUID(String(raw), label)
  if (!check.isValid) throw ApiError.badRequest(`${label}가 올바르지 않습니다.`)
  return check.sanitized
}

// PATCH: 담당자 지정·해제(관리자만). `expected_assignee_id`(화면이 알던 담당자, 없으면 null)로 낙관적 동시성을
// 지킨다. 후보는 지금 이사·감사·관리자인 승인·활성 회원만이다. 지정받은 사람에게는 응답 뒤에 웹 푸시가 간다
// (자기 자신을 지정했으면 보내지 않는다). 푸시가 실패해도 지정은 그대로다.
export const PATCH = defineApiRoute<{ assignee_id?: unknown; expected_assignee_id?: unknown }>({
  method: 'PATCH',
  name: 'api/admin/mailbox/[id]/assignee',
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
    return ApiError.internalServerError('담당자를 바꾸는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ body, params, auth }) => {
    const idCheck = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idCheck.isValid) throw ApiError.badRequest('유효한 id가 필요합니다.')
    const emailId = idCheck.sanitized
    const next = readOptionalId(body?.assignee_id, '담당자 id')
    const expected = readOptionalId(body?.expected_assignee_id, '기대 담당자 id')

    if (next) {
      const person = (await getWorkPeople([next])).get(next)
      if (!person || !canAccessBoardRoom(person)) {
        throw ApiError.badRequest('담당자는 지금 이사·감사·관리자인 사람만 지정할 수 있습니다.')
      }
    }

    const outcome = await setInboundAssignee({ id: emailId, expected, next, by: auth.user.id })
    if (outcome === 'missing') throw ApiError.notFound('메일을 찾을 수 없습니다.')
    if (outcome === 'conflict') {
      return ApiError.conflict('다른 관리자가 먼저 담당자를 바꿨습니다.').toNextResponse()
    }

    const names = await getDisplayNames([next, auth.user.id].filter(Boolean) as string[])
    if (next && next !== auth.user.id) {
      const email = await getInboundEmail(emailId)
      const payload = buildAssignmentPush({
        emailId,
        subject: (email?.subject as string | null) ?? null,
        assignerName: names.get(auth.user.id) ?? null,
      })
      // 응답을 막지 않는다. sendPushToUsers는 던지지 않고, VAPID 키가 없으면(E2E·프리뷰) 아무것도 하지 않는다.
      after(() => sendPushToUsers([next], payload))
    }

    return ApiSuccess.ok({
      id: emailId,
      assigned_to: next,
      assignee_name: next ? (names.get(next) ?? null) : null,
    })
  },
})
