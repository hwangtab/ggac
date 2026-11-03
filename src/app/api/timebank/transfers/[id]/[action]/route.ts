/**
 * 타임 기록의 확인·거절·취소(POST `/api/timebank/transfers/[id]/confirm|reject|cancel`)
 * (스펙 §5·§7.1·§7.2, 계획 Task 8). 그 밖의 action은 404.
 *
 * | action | 인가 | 꺼짐(§7.2) | 누가 |
 * | --- | --- | --- | --- |
 * | `confirm` | `requireTimebankParticipant` | 403 | 상대(`counterparty_id`) |
 * | `reject` | `requireTimebankReader` | 허용 | 상대(`counterparty_id`) |
 * | `cancel` | `requireTimebankReader` | 허용 | 기록자(`created_by`) |
 *
 * 거절·취소는 pending을 **줄이는** 동작이라 스위치가 꺼져도, 구판 동의·탈퇴 신청
 * 중이어도 막지 않는다. 확인은 잔액을 움직이므로 참여 자격을 요구하고, 원장이
 * 같은 트랜잭션에서 두 당사자의 자격과 하한을 다시 판정한다.
 *
 * 누가 할 수 있는지와 kind 제한(회원 간 `exchange`·`market`·`reversal`만 — 조정
 * pending은 `not_found`)은 원장의 조건부 UPDATE가 정한다. 라우트는 행위자를 세션
 * 회원으로 넘길 뿐이다. 실패 사유는 `describeLedgerError` 표로 바꾼다.
 *
 * 성공하면 다른 당사자에게 `notifyTransferDecided`(던지지 않는다), 활동
 * `timebank_transfer_decided`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  requireTimebankParticipant,
  requireTimebankReader,
  timebankRateLimit,
} from '@/lib/server/timebankAuth'
import { applyRouteRateLimit } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { parseTransferAction } from '@/lib/timebank/validate'
import { describeLedgerError, toMyTransferView } from '@/lib/timebank/format'
import {
  cancelTransfer,
  confirmTransfer,
  rejectTransfer,
  type TransferRow,
} from '@/db/queries/timebankLedger'
import { logUserActivity } from '@/db/queries/activities'
import { notifyTransferDecided } from '@/lib/server/timebankNotify'
import { createLogger } from '@/utils/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('timebankTransferDecide')

type RouteContext = { params: Promise<{ id: string; action: string }> }

const DONE_MESSAGE = {
  confirm: '기록을 확인했습니다.',
  reject: '기록을 거절했습니다.',
  cancel: '기록을 취소했습니다.',
} as const

export async function POST(request: NextRequest, context: RouteContext) {
  const params = await context.params
  const action = parseTransferAction(params.action)
  if (!action) return ApiError.notFound('요청한 동작을 찾을 수 없습니다.').toNextResponse()

  const validation = validateUUID(params.id, '기록 ID')
  if (!validation.isValid) {
    return ApiError.badRequest(
      validation.errors[0] || '잘못된 기록 ID 형식입니다.'
    ).toNextResponse()
  }
  const id = validation.sanitized

  // 확인만 참여 자격을 요구한다. 거절·취소는 꺼짐·구판 동의·동결에도 연다(§7.2).
  const auth =
    action === 'confirm' ? await requireTimebankParticipant() : await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user, settings } = auth

  const rl = await applyRouteRateLimit(request, timebankRateLimit('decide', user.id))
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  return apiPost(
    async () => {
      let row: TransferRow
      try {
        if (action === 'confirm') {
          // 판정 플래그(`over_soft_max`)는 받는 쪽 잔액을 드러내므로 회원 응답에 싣지
          // 않는다 — 관리자 화면이 잔액표로 따로 본다(§7.3).
          ;({ row } = await confirmTransfer({ id, actorId: user.id, settings }))
        } else if (action === 'reject') {
          row = await rejectTransfer({ id, actorId: user.id })
        } else {
          row = await cancelTransfer({ id, actorId: user.id })
        }
      } catch (error) {
        const described = describeLedgerError(error, {
          floorMinutes: settings.min_balance_minutes,
        })
        if (described) throw new ApiError(described.message, described.status, described.code)
        throw error
      }

      // 결정은 이미 커밋됐다. 활동 기록·알림 실패가 결정을 되돌리지 않는다.
      try {
        await logUserActivity({
          user_id: user.id,
          action_type: 'timebank_transfer_decided',
          metadata: {
            transfer_id: row.id,
            action,
            status: row.status,
            kind: row.kind,
            minutes: row.minutes,
          },
        })
      } catch (error) {
        log.error('타임 결정 활동 기록 실패', { error: (error as Error)?.message })
      }
      await notifyTransferDecided(row, user.id)

      return ApiSuccess.ok({ transfer: toMyTransferView(row, user.id) }, DONE_MESSAGE[action])
    },
    `/api/timebank/transfers/${id}/${action}`,
    { userId: user.id }
  )
}
