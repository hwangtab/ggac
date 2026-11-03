/**
 * 관리자 pending 취소(POST `/api/admin/timebank/transfers/[id]/cancel`, 스펙 §7.3,
 * 이용규칙 제12조 분쟁 정리, 계획 Task 9).
 *
 * 본문 `{ memo }` — **사유 필수**. kind 무관(회원 간 기록·조정 pending 모두).
 * 원장(`adminCancelPending`)이 조건부 UPDATE(`pending`만)로 바꾸고 사유를 행의
 * memo에 덧붙인다. 확정된 행은 409(`not_pending`) — 확정 후 정정은 당사자의
 * 되돌림 또는 각자와 coop 사이의 조정으로 한다(스펙 §3.1).
 *
 * pending은 잔액에 들어가지 않으므로 기능 스위치와 무관하게 연다(§7.2).
 * 행위자를 뺀 당사자 모두에게 `timebank_canceled`(사유 포함), 활동
 * `timebank_transfer_admin_canceled` + 보안 로그.
 */
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { AdminAuthSuccess } from '@/lib/server/adminAuth'
import {
  auditTimebankAdminWrite,
  timebankAdminErrorResponse,
  toLedgerApiError,
} from '@/lib/server/timebankAdmin'
import { notifyTransferCanceledByAdmin } from '@/lib/server/timebankNotify'
import { validateUUID } from '@/utils/validation'
import { parseAdminCancelInput } from '@/lib/timebank/adminRules'
import { adminCancelPending, type TransferRow } from '@/db/queries/timebankLedger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineApiRoute<Record<string, unknown>, AdminAuthSuccess>({
  method: 'POST',
  name: 'api/admin/timebank/transfers/[id]/cancel',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_cancel'),
  },
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: timebankAdminErrorResponse('cancel', '기록을 취소하지 못했습니다.'),
  handler: async ({ request, params, body, auth }) => {
    const validation = validateUUID(String(params.id ?? ''), '기록 ID')
    if (!validation.isValid) throw ApiError.badRequest('잘못된 기록 ID 형식입니다.')
    const id = validation.sanitized

    const parsed = parseAdminCancelInput(body)
    if (parsed.error !== null) throw ApiError.badRequest(parsed.error)
    const { memo } = parsed.value

    let row: TransferRow
    try {
      row = await adminCancelPending({ id, adminId: auth.user.id, memo })
    } catch (error) {
      throw toLedgerApiError(error)
    }

    await auditTimebankAdminWrite({
      request,
      actorId: auth.user.id,
      action_type: 'timebank_transfer_admin_canceled',
      target_type: 'timebank_transfer',
      target_id: row.id,
      metadata: {
        transfer_id: row.id,
        kind: row.kind,
        minutes: row.minutes,
        from_account: row.from_account,
        to_account: row.to_account,
        created_by: row.created_by,
        reason: memo,
      },
    })
    await notifyTransferCanceledByAdmin(row, { adminId: auth.user.id, memo })

    return ApiSuccess.ok({ transfer: row }, '기록을 취소했습니다.')
  },
})
