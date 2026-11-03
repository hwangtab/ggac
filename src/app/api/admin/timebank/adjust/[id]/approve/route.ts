/**
 * 조정 이중 승인(POST `/api/admin/timebank/adjust/[id]/approve`, 스펙 §7.3, 계획 Task 9).
 *
 * 승인자는 조정을 만든 사람도 대상도 아닌 다른 관리자여야 한다(`self_approval`).
 * 원장(`approveAdjustment`)이 조건부 UPDATE로 선점한 뒤 같은 트랜잭션에서 대상의
 * 참여 자격과 (차감이면) 하한을 다시 본다. 조정이 아닌 행은 `not_found`.
 *
 * 기능 스위치와 무관하다(§7.2). 적립이면 대상에게 `timebank_credited`.
 * 활동 `timebank_adjustment_approved` + 보안 로그.
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
import { notifyCredited } from '@/lib/server/timebankNotify'
import { validateUUID } from '@/utils/validation'
import { COOP_ACCOUNT } from '@/constants/timebank'
import { getTimebankSettings } from '@/lib/timebank/settings'
import { approveAdjustment, type TransferRow } from '@/db/queries/timebankLedger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineApiRoute<undefined, AdminAuthSuccess>({
  method: 'POST',
  name: 'api/admin/timebank/adjust/[id]/approve',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_approve'),
  },
  auth: 'admin',
  errorResponse: timebankAdminErrorResponse('approve', '조정을 승인하지 못했습니다.'),
  handler: async ({ request, params, auth }) => {
    const validation = validateUUID(String(params.id ?? ''), '조정 ID')
    if (!validation.isValid) throw ApiError.badRequest('잘못된 조정 ID 형식입니다.')
    const id = validation.sanitized

    const settings = await getTimebankSettings()
    let row: TransferRow
    try {
      row = await approveAdjustment({ id, approverId: auth.user.id, settings })
    } catch (error) {
      throw toLedgerApiError(error, settings)
    }

    const credit = row.from_account === COOP_ACCOUNT
    const memberId = credit ? row.to_account : row.from_account
    await auditTimebankAdminWrite({
      request,
      actorId: auth.user.id,
      action_type: 'timebank_adjustment_approved',
      target_type: 'timebank_transfer',
      target_id: row.id,
      metadata: {
        transfer_id: row.id,
        member_id: memberId,
        direction: credit ? 'credit' : 'debit',
        minutes: row.minutes,
        created_by: row.created_by,
        ref_type: row.ref_type,
        ref_id: row.ref_id,
      },
    })
    if (credit) await notifyCredited({ memberId, kind: 'adjustment', minutes: row.minutes })

    return ApiSuccess.ok({ transfer: row }, '조정을 승인했습니다.')
  },
})
