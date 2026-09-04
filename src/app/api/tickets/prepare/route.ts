/**
 * 예매 준비 — **자리를 먼저 잡고** 결제창을 연다.
 *
 * 순서를 뒤집어 결제부터 받으면, 매진된 회차의 표를 팔고 나서 환불해야 하는
 * 상황이 생긴다. 그래서 이 라우트가 좌석을 선점(`pending`)한 뒤에야 결제
 * 주문을 만든다. 결제하지 않고 사라지면 선점은 10분 뒤 자동으로 풀린다.
 *
 * 금액은 **클라이언트가 보낸 값을 쓰지 않는다.** 티켓 종류의 가격 × 매수로
 * 서버가 계산한다.
 */

import { NextRequest, NextResponse } from 'next/server'

import { getOptionalUser } from '@/lib/server/memberAuth'
import { getProfileById } from '@/db/queries/profiles'
import { createPendingPayment } from '@/db/queries/payments'
import {
  holdReservation,
  getShow,
  getTicketType,
  getRemainingSeats,
  SoldOutError,
} from '@/db/queries/ticketing'
import { generateOrderId, buildCustomerKey } from '@/lib/payments/toss/protocol'
import { isPaymentEnabled, getPublicClientKey } from '@/lib/payments/toss/config'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/tickets/prepare')

/**
 * 선점은 돈을 내지 않고도 재고를 줄인다 — 그것이 이 라우트의 존재 이유이면서
 * 동시에 약점이다. 비로그인으로 반복 호출하면 결제 한 푼 없이 공연을 매진
 * 시킬 수 있다. 선점이 10분 뒤 풀리더라도 그동안 진짜 관객은 표를 못 산다.
 *
 * 한 사람이 여러 회차를 비교하며 예매하는 것은 정상이므로 지나치게 좁히지
 * 않는다. 분당 10회면 사람의 예매는 걸리지 않고 자동 반복만 걸린다.
 */
const PREPARE_RATE_LIMIT = {
  name: 'ticket_prepare',
  windowMs: 60_000,
  maxRequests: 10,
  message: '예매 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 연락처는 숫자만 남겨 저장한다 — 현장에서 대조할 때 표기가 제각각이면 못 찾는다. */
function normalizePhone(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^0-9]/g, '') : ''
}

export async function POST(request: NextRequest) {
  try {
    if (!isPaymentEnabled()) {
      return ApiError.serviceUnavailable('예매를 준비 중입니다.').toNextResponse()
    }

    // 경로가 아니라 IP + 기능으로 나눈다 — 경로로 나누면 회차 id가 키에 들어가
    // "회차마다 10회"가 되어 회차 수만큼 곱해진다.
    const rl = await applyRouteRateLimit(request, {
      ...PREPARE_RATE_LIMIT,
      keyGenerator: createIPKeyGenerator('ticket-prepare'),
    })
    if (!rl.success) {
      return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
    }

    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    const showId = typeof body.showId === 'string' ? body.showId : ''
    const ticketTypeId = typeof body.ticketTypeId === 'string' ? body.ticketTypeId : ''
    const quantity = Number(body.quantity)
    const bookerName = typeof body.bookerName === 'string' ? body.bookerName.trim() : ''
    const bookerPhone = normalizePhone(body.bookerPhone)
    const bookerEmail = typeof body.bookerEmail === 'string' ? body.bookerEmail.trim() : ''

    if (!showId || !ticketTypeId) {
      return ApiError.badRequest('회차와 티켓 종류를 선택해 주세요.').toNextResponse()
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return ApiError.badRequest('매수를 확인해 주세요.').toNextResponse()
    }
    if (!bookerName) return ApiError.badRequest('예매자 이름을 입력해 주세요.').toNextResponse()
    if (bookerPhone.length < 9) {
      return ApiError.badRequest('연락처를 정확히 입력해 주세요.').toNextResponse()
    }

    const show = await getShow(showId)
    if (!show) return ApiError.notFound('회차를 찾을 수 없습니다.').toNextResponse()
    if (new Date(String(show.starts_at)).getTime() <= Date.now()) {
      return ApiError.badRequest('이미 시작된 공연은 예매할 수 없습니다.').toNextResponse()
    }

    const ticketType = await getTicketType(ticketTypeId)
    if (!ticketType || ticketType.performance_id !== show.performance_id) {
      return ApiError.badRequest('티켓 종류가 올바르지 않습니다.').toNextResponse()
    }
    if (quantity > Number(ticketType.max_per_order)) {
      return ApiError.badRequest(
        `1회에 최대 ${ticketType.max_per_order}매까지 예매할 수 있습니다.`
      ).toNextResponse()
    }

    // 비회원도 예매할 수 있다. 로그인했으면 예매 내역을 마이페이지에서 볼 수 있게 연결한다.
    const user = await getOptionalUser()
    if (ticketType.members_only && !user) {
      return ApiError.forbidden('조합원 전용 티켓입니다. 로그인 후 이용해 주세요.').toNextResponse()
    }

    // 금액은 서버가 정한다.
    const unitPrice = Number(ticketType.price)
    const totalAmount = unitPrice * quantity
    if (totalAmount <= 0) {
      return ApiError.badRequest('무료 티켓은 결제가 필요하지 않습니다.').toNextResponse()
    }

    // 주문번호를 **선점보다 먼저** 만든다. 예매와 결제를 잇는 것이 이 값뿐이라,
    // 자리를 잡는 INSERT에 함께 새겨야 둘 사이에 짝 없는 상태가 생기지 않는다.
    const orderId = generateOrderId('ticket')

    let reservation
    try {
      reservation = await holdReservation({
        orderId,
        showId,
        ticketTypeId,
        userId: user?.id ?? null,
        bookerName,
        bookerPhone,
        bookerEmail: bookerEmail || null,
        quantity,
        unitPrice,
      })
    } catch (error) {
      if (error instanceof SoldOutError) {
        return ApiError.badRequest(error.message).toNextResponse()
      }
      // 동시 예매가 몰려 자리를 잡지 못했다. 좌석이 없는 것과는 다르므로
      // 다시 시도하면 된다고 안내한다.
      log.warn('좌석 선점 실패', { showId, error: error instanceof Error ? error.message : error })
      return ApiError.serviceUnavailable(
        '예매가 몰리고 있습니다. 잠시 후 다시 시도해 주세요.'
      ).toNextResponse()
    }

    const orderName = `${show.performance_id ? '' : ''}${ticketType.name} ${quantity}매`
    const profile = user ? await getProfileById(user.id) : null

    await createPendingPayment({
      orderId,
      userId: user?.id ?? null,
      kind: 'ticket',
      orderName,
      amount: totalAmount,
      payerName: bookerName,
      payerEmail: bookerEmail || profile?.email || null,
    })

    log.info('예매 준비', { showId, reservationId: reservation.id, orderId })

    return ApiSuccess.ok({
      orderId,
      orderName,
      amount: totalAmount,
      reservationId: reservation.id,
      reservationCode: reservation.reservation_code,
      holdExpiresAt: reservation.hold_expires_at,
      remainingSeats: await getRemainingSeats(showId),
      clientKey: getPublicClientKey(),
      // 비회원은 익명 식별값을 쓴다 — 결제창은 회원 여부와 무관하게 열려야 한다.
      customerKey: user
        ? buildCustomerKey(user.id)
        : `g_${reservation.id.replace(/-/g, '')}`.slice(0, 50),
      customerName: bookerName,
      customerEmail: bookerEmail || undefined,
    }).toNextResponse()
  } catch (error) {
    log.error('예매 준비 실패:', error)
    return ApiError.internalServerError('예매를 준비하지 못했습니다.').toNextResponse()
  }
}
