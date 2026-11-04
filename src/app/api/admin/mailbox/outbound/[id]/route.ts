import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { getOutboundEmail, listOutboundAttachments } from '@/db/queries/mailbox'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

// GET: 새로 작성해 보낸 메일 한 건 상세 + 첨부 목록 (이사·감사·관리자)
//
// BCC는 관리자에게만 주소를 보여 준다. 이사·감사에게는 개수만 준다 — 숨은참조는 수신자끼리도
// 서로 모르게 하려는 의도라, 열람 범위를 넓힌다고 그 의도까지 넓히지 않는다. 가림은 여기서 한다
// (쿼리 계층은 권한을 모른다). 첨부의 저장소 경로(`blob_path`)는 누구에게도 내려보내지 않는다.
export const GET = defineApiRoute<undefined, BoardAuthSuccess>({
  method: 'GET',
  name: 'api/admin/mailbox/outbound/[id]',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  rateLimitHeaders: true,
  auth: 'board-member',
  errorResponse: () => {
    logSecurityEvent(
      'ADMIN_MAILBOX_OUTBOUND_API_ERROR',
      { error: '서버 오류가 발생했습니다.' },
      'medium'
    )
    return ApiError.internalServerError('메일을 조회하는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ params, auth }) => {
    const idValidation = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idValidation.isValid) throw ApiError.badRequest('유효한 id가 필요합니다.')
    const id = idValidation.sanitized

    const email = await getOutboundEmail(id)
    if (!email) throw ApiError.notFound('메일을 찾을 수 없습니다.')

    const bcc = parseList(email.bcc_addresses)
    const { idempotency_key: _key, bcc_addresses: _bcc, ...rest } = email
    void _key
    void _bcc
    const safeEmail = {
      ...rest,
      to_addresses: parseList(email.to_addresses),
      cc_addresses: parseList(email.cc_addresses),
      bcc_count: bcc.length,
      ...(auth.isAdmin ? { bcc_addresses: bcc } : {}),
    }

    const attachments = (await listOutboundAttachments(id)).map(
      ({ blob_path: _path, ...attachment }) => {
        void _path
        return attachment
      }
    )

    return ApiSuccess.ok({ email: safeEmail, attachments, can_manage: auth.isAdmin })
  },
})
