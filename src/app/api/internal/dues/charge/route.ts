/**
 * 매월 조합비 자동 청구 (크론 전용).
 *
 * 판단 로직은 `src/lib/payments/billingRun.ts`에 있고 여기는 **배선만** 한다.
 * 그래야 이중 청구가 나는 조건들을 네트워크 없이 테스트할 수 있다.
 *
 * 인증은 기존 정리 크론(`/api/cleanup/temp-attachments`)과 같은 방식 —
 * 공유 토큰을 타이밍 안전 비교한다.
 */

import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { listActiveBillingTargets } from '@/db/queries/billingKeys'
import {
  getDues,
  ensureDues,
  createPendingPayment,
  markPaymentDone,
  markPaymentFailed,
  markDuesPaid,
  claimDuesForCharge,
  releaseDuesClaim,
  getPaymentByOrderId,
} from '@/db/queries/payments'
import { createNotification } from '@/db/queries/notifications'
import { chargeBilling } from '@/lib/payments/toss/client'
import { runBillingCharges } from '@/lib/payments/billingRun'
import {
  currentBillingMonth,
  getBillingConfig,
  isBillingEnabled,
  isPaymentEnabled,
} from '@/lib/payments/toss/config'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('api/internal/dues/charge')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * 자동결제 승인은 한 건에 최대 60초까지 걸린다. 조합원이 늘면 이 시간으로도
 * 모자라게 되는데, 그때는 한 번에 도는 인원을 나눠야 한다(현재 조합원 수로는
 * 여유가 있다).
 */
export const maxDuration = 800

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.PAYMENTS_CRON_TOKEN
  if (!expected) return false

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (provided.length !== expected.length) return false

  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
    }
    if (!isPaymentEnabled() || !isBillingEnabled()) {
      return ApiError.serviceUnavailable('자동결제가 활성화되어 있지 않습니다.').toNextResponse()
    }

    const { secretKey } = getBillingConfig()
    const billingMonth = currentBillingMonth()

    const result = await runBillingCharges({
      billingMonth,
      listTargets: listActiveBillingTargets,
      getDues,
      ensureDues,
      createPendingPayment,
      charge: (billingKey, input) => chargeBilling(billingKey, input, { secretKey }),
      markPaymentDone,
      markPaymentFailed,
      markDuesPaid,
      claimDuesForCharge,
      releaseDuesClaim,
      getPaymentByOrderId,
      notifyFailure: async input => {
        // 카드 한도 초과나 유효기간 만료가 대부분이라, 회원이 카드를 바꿔
        // 끼우면 해결된다. 알림이 없으면 회원은 미납 사실 자체를 모른다.
        try {
          await createNotification({
            user_id: input.userId,
            type: 'system_notice',
            title: '조합비 자동결제에 실패했습니다',
            message: `${billingMonth} 조합비 결제가 되지 않았습니다. 마이페이지 > 조합비에서 카드를 다시 등록해 주세요.`,
            data: { billingMonth, reason: input.reason },
          })
        } catch (error) {
          log.error('자동결제 실패 알림 생성 실패', {
            userId: maskId(input.userId),
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
      log,
    })

    log.info('자동결제 실행 완료', { billingMonth, ...result })
    return ApiSuccess.ok({ billingMonth, ...result }).toNextResponse()
  } catch (error) {
    log.error('자동결제 실행 실패:', error)
    return ApiError.internalServerError('자동결제를 실행하지 못했습니다.').toNextResponse()
  }
}
