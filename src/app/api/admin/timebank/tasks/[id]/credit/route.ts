/**
 * 조합 업무 크레딧 지급(스펙 §6.3·§7.3, 계획 Task 9).
 *
 * - GET: 지급 화면 — 글과 철회하지 않은 자원자(`listVolunteers`).
 * - POST 본문 `{ member_id, minutes, memo, not_paid_elsewhere: true }`. 지급 조건은
 *   원장(`creditCoopTask` → `judgeCoopCredit`)이 한 트랜잭션에서 전부 본다:
 *   자원 기록(철회 안 함)·판정 1·지급자 ≠ 대상·같은 글 중복 없음(유일 인덱스)·
 *   월 상한·"사례비·인건비 미지급" 확인·memo. 사유마다 상태·문구가 다르다
 *   (`describeLedgerError`).
 *
 * 스위치: 전체 + `coop_tasks_enabled`가 둘 다 `=== true`여야 한다(아니면 403).
 * 성공하면 받은 회원에게 `timebank_credited`, 활동 `timebank_coop_credit` + 보안 로그.
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
import {
  COOP_TASKS_OFF_MESSAGE,
  coopTasksOpen,
  parseCoopCreditInput,
} from '@/lib/timebank/adminRules'
import { getTimebankSettings } from '@/lib/timebank/settings'
import { creditCoopTask, type TransferRow } from '@/db/queries/timebankLedger'
import { getTimebankListing, listVolunteers } from '@/db/queries/timebankBoard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOT_FOUND = '조합 업무 글을 찾을 수 없습니다.'

function listingIdFrom(params: Record<string, string | string[]>): string {
  const validation = validateUUID(String(params.id ?? ''), '글 ID')
  if (!validation.isValid) throw ApiError.badRequest('잘못된 글 ID 형식입니다.')
  return validation.sanitized
}

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/timebank/tasks/[id]/credit',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_credit'),
  },
  auth: 'admin',
  errorResponse: timebankAdminErrorResponse('credit', '지급 화면을 불러오지 못했습니다.'),
  handler: async ({ params }) => {
    const listingId = listingIdFrom(params)
    const listing = await getTimebankListing(listingId)
    if (!listing || listing.kind !== 'coop_task') throw ApiError.notFound(NOT_FOUND)
    return ApiSuccess.ok({ listing, volunteers: await listVolunteers(listingId) })
  },
})

export const POST = defineApiRoute<Record<string, unknown>, AdminAuthSuccess>({
  method: 'POST',
  name: 'api/admin/timebank/tasks/[id]/credit',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_credit'),
  },
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: timebankAdminErrorResponse('credit', '조합 업무 크레딧을 지급하지 못했습니다.'),
  handler: async ({ request, params, body, auth }) => {
    const listingId = listingIdFrom(params)
    const settings = await getTimebankSettings()
    if (!coopTasksOpen(settings)) throw ApiError.forbidden(COOP_TASKS_OFF_MESSAGE)

    const parsed = parseCoopCreditInput(body)
    if (parsed.error !== null) throw ApiError.badRequest(parsed.error)
    const input = parsed.value

    let row: TransferRow
    try {
      row = await creditCoopTask({
        listingId,
        memberId: input.member_id,
        actorId: auth.user.id,
        minutes: input.minutes,
        memo: input.memo,
        notPaidElsewhere: input.not_paid_elsewhere,
        settings,
      })
    } catch (error) {
      throw toLedgerApiError(error, settings)
    }

    // 지급은 이미 커밋됐다. 기록·알림은 지급을 되돌리지 않는다(둘 다 던지지 않는다).
    await auditTimebankAdminWrite({
      request,
      actorId: auth.user.id,
      action_type: 'timebank_coop_credit',
      target_type: 'timebank_transfer',
      target_id: row.id,
      metadata: {
        transfer_id: row.id,
        listing_id: listingId,
        member_id: input.member_id,
        minutes: row.minutes,
        memo: row.memo,
        not_paid_elsewhere: true,
      },
    })
    await notifyCredited({ memberId: input.member_id, kind: 'coop_task', minutes: row.minutes })

    return ApiSuccess.created({ transfer: row }, '조합 업무 크레딧을 지급했습니다.')
  },
})
