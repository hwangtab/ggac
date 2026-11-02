/**
 * 관리자 조정(POST `/api/admin/timebank/adjust`, 스펙 §3.1·§7.3, 계획 Task 9).
 *
 * 본문 `{ member_id, direction: 'credit'|'debit', minutes, memo, dispute?, resolution_ref? }`.
 * **회원 ↔ coop만**(회원 사이로 옮기는 값은 본문에 담을 자리가 없다), 대상 ≠ 본인,
 * memo 필수, 30분 배수, 대상 참여 자격, 차감은 하한. 판정은 원장(`createAdjustment`)이
 * 한 트랜잭션에서 한다.
 *
 * 이중 승인(pending, `counterparty_id` null — 조합원 경로로는 닿지 않는다):
 * 그달 그 대상 조정 누적이 `adjustment_dual_approval_minutes`를 넘게 되는 건,
 * 분쟁 정리(`dispute: true`, 이사회 결정 근거 필수), 대상이 관리자인 건. 대상이
 * 관리자인지는 여기서 프로필로 판정해 넘긴다.
 *
 * 기능 스위치와 무관하다(§7.2 — 꺼져도 조정은 된다). 즉시 확정된 적립이면 대상에게
 * `timebank_credited`. 활동 `timebank_adjustment` + 보안 로그.
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
import { COOP_ACCOUNT } from '@/constants/timebank'
import { parseAdjustInput } from '@/lib/timebank/adminRules'
import { getTimebankSettings } from '@/lib/timebank/settings'
import { createAdjustment, type TransferRow } from '@/db/queries/timebankLedger'
import { getProfileAuthzFields } from '@/db/queries/profiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineApiRoute<Record<string, unknown>, AdminAuthSuccess>({
  method: 'POST',
  name: 'api/admin/timebank/adjust',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_adjust'),
  },
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: timebankAdminErrorResponse('adjust', '조정을 기록하지 못했습니다.'),
  handler: async ({ request, body, auth }) => {
    const parsed = parseAdjustInput(body)
    if (parsed.error !== null) throw ApiError.badRequest(parsed.error)
    const input = parsed.value

    const target = await getProfileAuthzFields(input.member_id)
    if (!target) throw ApiError.notFound('조합원을 찾을 수 없습니다.')

    const settings = await getTimebankSettings()
    let row: TransferRow
    try {
      row = await createAdjustment({
        adminId: auth.user.id,
        memberId: input.member_id,
        direction: input.direction,
        minutes: input.minutes,
        memo: input.memo,
        dispute: input.dispute,
        targetIsAdmin: target.is_admin === true,
        settings,
      })
    } catch (error) {
      throw toLedgerApiError(error, settings)
    }

    const needsApproval = row.status === 'pending'
    await auditTimebankAdminWrite({
      request,
      actorId: auth.user.id,
      action_type: 'timebank_adjustment',
      target_type: 'timebank_transfer',
      target_id: row.id,
      metadata: {
        transfer_id: row.id,
        member_id: input.member_id,
        direction: input.direction,
        minutes: row.minutes,
        memo: row.memo,
        status: row.status,
        dispute_ref: input.dispute?.resolution_ref ?? null,
        target_is_admin: target.is_admin === true,
      },
    })
    if (!needsApproval && row.from_account === COOP_ACCOUNT) {
      await notifyCredited({ memberId: input.member_id, kind: 'adjustment', minutes: row.minutes })
    }

    return ApiSuccess.created(
      { transfer: row, needs_approval: needsApproval },
      needsApproval
        ? '조정을 기록했습니다. 다른 관리자의 승인을 받아야 확정됩니다.'
        : '조정을 확정했습니다.'
    )
  },
})
