/**
 * 타임 기록(POST) — 회원 간 이동을 pending으로 남긴다 (스펙 §5·§7.1, 계획 Task 8).
 *
 * - `requireTimebankParticipant`: 켜짐 + 현재 판 동의 + 탈퇴 신청 중 아님(§7.2 —
 *   꺼지면 기록 불가).
 * - 본문은 `{ counterparty_id, role, minutes, category?, memo?, listing_id?,
 *   reverses_id? }`만 읽는다(`parseTransferInput`). **`kind`·`from_account`·
 *   `to_account`·`coop`은 읽지 않는다** — kind는 `reverses_id`가 있으면
 *   `reversal`, 아니면 `exchange`이고, 방향은 원장이 `directionFor(role, 세션
 *   회원, 상대)`로 만든다. 기록자는 언제나 세션 회원이다. `market`(1-B)은
 *   여기서 만들 수 없다.
 * - 원장 거부 사유는 `describeLedgerError` 표가 사람 말과 상태 코드로 바꾼다.
 * - 커밋 뒤 상대에게 `notifyTransferPending`(던지지 않는다), 활동
 *   `timebank_transfer_recorded`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireTimebankParticipant, timebankRateLimit } from '@/lib/server/timebankAuth'
import { applyRouteRateLimit } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { parseTransferInput } from '@/lib/timebank/validate'
import { describeLedgerError, toMyTransferView } from '@/lib/timebank/format'
import { createMemberTransfer, type TransferRow } from '@/db/queries/timebankLedger'
import { getTimebankListingOwner } from '@/db/queries/timebankBoard'
import { logUserActivity } from '@/db/queries/activities'
import { notifyTransferPending } from '@/lib/server/timebankNotify'
import { createLogger } from '@/utils/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('timebankTransfers')

export async function POST(request: NextRequest) {
  const auth = await requireTimebankParticipant()
  if (auth instanceof NextResponse) return auth
  const { user, settings } = auth

  const rl = await applyRouteRateLimit(request, timebankRateLimit('record', user.id))
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
      const parsed = parseTransferInput(body)
      if (parsed.error !== null) throw ApiError.badRequest(parsed.error)
      const input = parsed.value

      // 관련 글은 살아 있는 제공·요청 글만. 조합 업무는 관리자 지급(§6)으로만 크레딧이 된다.
      if (input.listing_id) {
        const listing = await getTimebankListingOwner(input.listing_id)
        if (!listing || listing.kind === 'coop_task') {
          throw ApiError.notFound('관련 글을 찾을 수 없습니다.')
        }
      }

      let row: TransferRow
      try {
        row = await createMemberTransfer({
          recorderId: user.id,
          counterpartyId: input.counterparty_id,
          kind: input.kind,
          // `reversal`은 원장이 방향을 원 이동에서 정하고 role을 보지 않는다.
          role: input.role ?? 'received',
          minutes: input.minutes,
          category: input.category,
          memo: input.memo,
          refType: input.listing_id ? 'listing' : null,
          refId: input.listing_id,
          reversesId: input.reverses_id,
          settings,
        })
      } catch (error) {
        const described = describeLedgerError(error, {
          floorMinutes: settings.min_balance_minutes,
        })
        if (described) throw new ApiError(described.message, described.status, described.code)
        throw error
      }

      // 기록은 이미 커밋됐다. 활동 기록·알림 실패가 기록을 되돌리지 않는다.
      try {
        await logUserActivity({
          user_id: user.id,
          action_type: 'timebank_transfer_recorded',
          metadata: {
            transfer_id: row.id,
            kind: row.kind,
            minutes: row.minutes,
            counterparty_id: row.counterparty_id,
          },
        })
      } catch (error) {
        log.error('타임 기록 활동 기록 실패', { error: (error as Error)?.message })
      }
      await notifyTransferPending(row)

      return ApiSuccess.created(
        { transfer: toMyTransferView(row, user.id) },
        '기록을 남겼습니다. 상대가 확인하면 확정됩니다.'
      )
    },
    '/api/timebank/transfers',
    { userId: user.id }
  )
}
