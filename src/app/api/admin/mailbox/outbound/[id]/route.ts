import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { AdminAuthSuccess } from '@/lib/server/adminAuth'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import {
  getOutboundEmail,
  listOutboundAttachments,
  resolveOutboundStatus,
} from '@/db/queries/mailbox'
import { logUserActivity } from '@/db/queries/activities'
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

/** 이 시간보다 오래된 `sending`만 사람이 확정할 수 있다. 화면의 "확인 필요" 기준(5분)과 같다. */
const STUCK_SENDING_MS = 5 * 60 * 1000

// PATCH: 멈춘 보낸 메일(`unknown`·오래된 `sending`)을 운영자가 확인한 결과로 확정한다(관리자만)
//
// 이 라우트는 메일을 보내지 않는다 — 장부의 상태만 바꾼다. 운영자가 Resend 대시보드에서 실제로 나갔는지
// 확인한 뒤 `sent`(나갔음) 또는 `failed`(안 나갔음)로 표시한다. `failed`로 바꾸면 24시간 한도 계산에서
// 빠진다. 누가 무엇으로 바꿨는지는 활동 기록에 남는다.
export const PATCH = defineApiRoute<{ status?: string }, AdminAuthSuccess>({
  method: 'PATCH',
  name: 'api/admin/mailbox/outbound/[id]',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse: () => {
    logSecurityEvent(
      'ADMIN_MAILBOX_OUTBOUND_API_ERROR',
      { error: '서버 오류가 발생했습니다.' },
      'medium'
    )
    return ApiError.internalServerError('상태를 바꾸는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ body, params, auth, request }) => {
    const idValidation = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idValidation.isValid) throw ApiError.badRequest('유효한 id가 필요합니다.')
    const id = idValidation.sanitized

    const next = body?.status
    if (next !== 'sent' && next !== 'failed') {
      throw ApiError.badRequest('status는 sent 또는 failed여야 합니다.')
    }

    const outcome = await resolveOutboundStatus(id, next, Date.now() - STUCK_SENDING_MS)
    if (outcome === 'missing') throw ApiError.notFound('메일을 찾을 수 없습니다.')
    if (outcome === 'conflict') {
      throw ApiError.conflict(
        '확정할 수 없는 상태입니다. 이미 처리됐거나 아직 발송 중일 수 있습니다. 새로고침해 주세요.'
      )
    }

    try {
      await logUserActivity({
        user_id: auth.user.id,
        action_type: 'admin_action',
        target_type: 'outbound_email',
        target_id: id,
        metadata: { action: 'mailbox_outbound_resolve', status: next },
        ip_address:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        user_agent: request.headers.get('user-agent') || null,
      })
    } catch (error) {
      // 상태는 이미 바뀌었다. 기록 실패가 그 사실을 되돌리거나 오류로 보이게 하지 않는다.
      logSecurityEvent(
        'MAILBOX_COMPOSE_AUDIT_FAILED',
        { id, error: error instanceof Error ? error.message : String(error) },
        'high'
      )
    }

    return ApiSuccess.ok({ id, status: next })
  },
})
