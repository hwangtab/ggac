/**
 * 조합비 결제 승인 확정.
 *
 * 결제창이 성공 주소로 돌려보낸 뒤 화면이 호출한다. 이 라우트가 하는 일 중
 * **금액 대조**가 가장 중요하다. 결제 요청은 브라우저에서 일어나므로 사용자가
 * 콘솔로 금액을 바꿀 수 있고, 돌아온 값을 그대로 승인에 넘기면 조작된 금액으로
 * 결제가 완료된다. 그래서 두 가지를 지킨다.
 *
 *  1. 돌아온 금액이 원장에 저장된 금액과 같은지 대조한다.
 *  2. 토스에 넘기는 금액은 **수신값이 아니라 저장값**이다.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import {
  getDues,
  getPaymentByOrderId,
  markPaymentDone,
  markPaymentFailed,
  markDuesPaid,
  recordPaymentKey,
} from '@/db/queries/payments'
import { assertAmountMatches, AmountMismatchError } from '@/lib/payments/toss/protocol'
import { confirmPayment, TossApiError, TossLookupError } from '@/lib/payments/toss/client'
import {
  getServerPaymentConfig,
  isPaymentEnabled,
  currentBillingMonth,
} from '@/lib/payments/toss/config'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('api/payments/dues/confirm')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 토스 승인은 최대 60초까지 걸린다. 기본 함수 시간으로는 모자랄 수 있다. */
export const maxDuration = 90

export async function POST(request: NextRequest) {
  try {
    if (!isPaymentEnabled()) {
      return ApiError.serviceUnavailable('결제 기능이 준비 중입니다.').toNextResponse()
    }

    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    const paymentKey = typeof body.paymentKey === 'string' ? body.paymentKey : ''
    const orderId = typeof body.orderId === 'string' ? body.orderId : ''
    if (!paymentKey || !orderId) {
      return ApiError.badRequest('결제 정보가 올바르지 않습니다.').toNextResponse()
    }

    const payment = await getPaymentByOrderId(orderId)
    if (!payment) {
      return ApiError.notFound('결제 내역을 찾을 수 없습니다.').toNextResponse()
    }

    // **이 주문이 조합비 주문인지 본다.** 원장(`payments`)은 조합비·티켓·펀딩을
    // 한 테이블에 담고 `getPaymentByOrderId`는 주문번호만으로 찾는다. 이 검사가
    // 없으면 티켓·펀딩 주문번호를 이 라우트로 보내 그 결제가 조합비 납부로
    // 기록된다 — 만원짜리 티켓 하나로 그 달 회비가 납부 완료가 되고,
    // `markDuesPaid`는 미납 행만 바꾸므로 청구 크론도 그 달을 다시 걷지 않는다.
    // 아래 금액 대조는 "원장 저장값 = 수신값"만 보므로 이것을 잡지 못한다.
    //
    // 티켓·펀딩 확정은 각자 예약·후원 행과 주문번호가 짝인지 확인하기 때문에
    // 구조적으로 막혀 있었다. 대상을 주문이 아니라 **세션에서** 정하는 것은 이
    // 라우트뿐이라 여기만 뚫려 있었다. 답은 "찾을 수 없다"로 같게 준다 — 그
    // 번호로 다른 종류의 주문이 있다는 사실 자체를 알려 줄 이유가 없다.
    if (payment.kind !== 'dues') {
      log.warn('조합비가 아닌 주문으로 조합비 확정 시도', {
        userId: maskId(user.id),
        orderId,
        kind: String(payment.kind ?? ''),
      })
      return ApiError.notFound('결제 내역을 찾을 수 없습니다.').toNextResponse()
    }

    // 남의 주문번호로 승인을 시도하는 경로를 막는다.
    if (payment.user_id !== user.id) {
      log.warn('다른 회원의 주문 승인 시도', {
        userId: maskId(user.id),
        orderOwner: maskId(String(payment.user_id ?? '')),
        orderId,
      })
      return ApiError.forbidden('본인의 결제만 확정할 수 있습니다.').toNextResponse()
    }

    // 이미 확정된 주문이면 그대로 성공으로 답한다 — 성공 화면 새로고침이
    // 오류로 보이면 안 되고, 재확정은 원장을 건드리지 않는다.
    if (payment.status === 'done') {
      return ApiSuccess.ok({ orderId, status: 'done', amount: payment.amount }).toNextResponse()
    }

    const storedAmount = Number(payment.amount)
    try {
      assertAmountMatches(storedAmount, body.amount)
    } catch (error) {
      if (error instanceof AmountMismatchError) {
        // 조작 시도일 수 있으므로 두 값을 함께 남긴다.
        log.error('결제 금액 불일치', {
          userId: maskId(user.id),
          orderId,
          expected: error.expected,
          received: String(error.received),
        })
        await markPaymentFailed(orderId, {
          code: 'AMOUNT_MISMATCH',
          message: '결제 금액이 주문 금액과 일치하지 않습니다.',
        })
        return ApiError.badRequest(
          '결제 금액이 일치하지 않아 승인하지 않았습니다.'
        ).toNextResponse()
      }
      throw error
    }

    const { secretKey } = getServerPaymentConfig()

    // 승인 호출 **전에** 결제 식별자를 원장에 새긴다. 이것이 없으면 승인은 났는데
    // 응답이 유실된 건의 원장에 `payment_key`가 비어 있고, 그 결제는 토스에서
    // 다시 찾을 방법이 없다 — 회비는 영영 미납으로 남고 다음 달 청구가 또 나간다.
    // `markPaymentDone`이 같은 값을 다시 적으므로 여기서 적어 두어도 어긋나지 않는다.
    await recordPaymentKey(orderId, paymentKey)

    let approved: Record<string, unknown>
    try {
      // 저장값을 넘긴다. 수신값은 위에서 대조에만 썼다.
      approved = await confirmPayment({ paymentKey, orderId, amount: storedAmount }, { secretKey })
    } catch (error) {
      if (error instanceof TossApiError) {
        // 토스가 명확히 거절했다. 실패로 확정해도 안전하다.
        await markPaymentFailed(orderId, { code: error.code, message: error.message })
        log.warn('결제 승인 거절', { orderId, code: error.code })
        return ApiError.badRequest(error.message).toNextResponse()
      }
      if (error instanceof TossLookupError) {
        // 승인됐는지 알 수 없다. **실패로 기록하지 않는다** — 대사 크론이
        // 나중에 토스에 물어 실제 상태로 맞춘다. 여기서 실패로 확정하면
        // 실제로 승인된 결제가 미결제로 남는다.
        log.error('결제 승인 판단 불가(대사 대기)', { orderId, message: error.message })
        return ApiError.serviceUnavailable(
          '결제 결과를 확인하는 중입니다. 잠시 후 마이페이지에서 결과를 확인해 주세요.'
        ).toNextResponse()
      }
      throw error
    }

    const approvedAt =
      typeof approved.approvedAt === 'string' ? approved.approvedAt : new Date().toISOString()
    await markPaymentDone(orderId, {
      paymentKey,
      method: typeof approved.method === 'string' ? approved.method : null,
      approvedAt,
      raw: approved,
    })

    // 결제와 청구월을 연결한다.
    //
    // **청구월은 시계가 아니라 이 주문에서 나온다.** 예전에는 확정하는 그
    // 순간의 `currentBillingMonth()`를 썼는데, 준비(prepare)와 확정 사이에
    // 달이 넘어가면 — 월말 23시 59분에 결제창을 띄우고 자정을 넘겨 승인이
    // 끝나는, 실제로 일어나는 일이다 — **다음 달이 납부 완료로 찍힌다.**
    // 그러면 정작 결제한 달은 미납으로 남아 다음 청구가 또 나가고, 새 달은
    // 걷지도 않은 채 납부로 굳는다(`markDuesPaid`는 미납 행만 바꾸므로 그 뒤
    // 진짜 납부가 들어와도 덮이지 않는다).
    //
    // 준비 라우트가 그 시점의 청구월로 회비 행을 만들고 주문을 남겼으므로,
    // 같은 값은 **주문이 만들어진 시각**에서 다시 얻는다. 브라우저가 보낸
    // 값은 어느 쪽으로도 쓰지 않는다.
    try {
      const confirmed = await getPaymentByOrderId(orderId)
      const orderedAt = confirmed?.created_at ? new Date(String(confirmed.created_at)) : null
      const billingMonth =
        orderedAt && !Number.isNaN(orderedAt.getTime())
          ? currentBillingMonth(orderedAt)
          : currentBillingMonth()

      // 이미 납부로 기록된 달은 건드리지 않는다. 아래 쓰기도 `unpaid`일 때만
      // 걸리므로 덮일 일은 없지만, 두 번째 확정이 조용히 지나가 버리면 "왜
      // 이 결제가 어느 달에도 안 붙었는가"를 나중에 되짚을 수 없다.
      const before = await getDues(user.id, billingMonth)
      if (before?.status === 'paid') {
        log.warn('이미 납부된 달의 확정 요청 — 회비 연결을 건너뜀', {
          userId: maskId(user.id),
          orderId,
          billingMonth,
        })
      } else {
        await markDuesPaid({
          userId: user.id,
          billingMonth,
          paymentId: String(confirmed?.id ?? ''),
        })
      }
    } catch (error) {
      log.error('회비 납부 연결 실패(결제는 확정됨)', { orderId, error })
    }

    log.info('조합비 결제 확정', { userId: maskId(user.id), orderId })
    return ApiSuccess.ok({ orderId, status: 'done', amount: storedAmount }).toNextResponse()
  } catch (error) {
    log.error('조합비 결제 확정 실패:', error)
    return ApiError.internalServerError('결제를 확정하지 못했습니다.').toNextResponse()
  }
}
