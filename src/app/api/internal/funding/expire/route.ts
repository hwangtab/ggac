/**
 * 만료된 후원 선점 정리 (크론 전용, 10분마다).
 *
 * 판단은 `expiryGuard.ts`, 여기는 배선만. 만료 전에 토스를 먼저 본다 — 승인은
 * 됐는데 confirm이 유실된 건을 만료 대신 확정한다.
 *
 * 인증은 업로드 정리 크론과 같다: `CRON_SECRET` Bearer, 없으면 닫는다.
 */
import { NextRequest, after } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import {
  listExpiredHolds,
  listStuckHolds,
  expirePledge,
  finalizePledgePayment,
  cancelPendingPledge,
  PledgeStockUnavailableError,
} from '@/db/queries/fundingPledges'
import { getPaymentByOrderId, markPaymentFailed } from '@/db/queries/payments'
import {
  cancelPayment,
  lookupPayment,
  TossLookupError,
  TossApiError,
} from '@/lib/payments/toss/client'
import { getServerPaymentConfig, isPaymentEnabled } from '@/lib/payments/toss/config'
import { runExpiryGuard } from '@/lib/funding/expiryGuard'
import { notifyPledgeRefunded, notifyPledgePaid, notifyStuckHolds } from '@/lib/funding/notify'
import { sendNoticesPaced } from '@/lib/funding/pacedNotices'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/internal/funding/expire')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * 한 번에 최대 100건을 훑고, 그중 환불된 건마다 통지를 **간격을 두고** 보낸다
 * (초당 2통 — `sendNoticesPaced`). 창이 가득 찬 최악의 경우 조회 100회(≈30초)에
 * 통지 100건(≈50초)이라 여유가 있다. 통지는 `after()`로 응답 뒤에 나가지만
 * 함수 수명은 그때까지 이어지므로, 그 몫까지 이 값이 덮어야 한다.
 */
export const maxDuration = 300

function isAuthorized(request: NextRequest): boolean {
  const expected = [process.env.CRON_SECRET].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  )
  if (expected.length === 0) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  return expected.some(
    t => provided.length === t.length && timingSafeEqual(Buffer.from(provided), Buffer.from(t))
  )
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) return ApiError.unauthorized('권한이 없습니다.').toNextResponse()
  if (!isPaymentEnabled()) return ApiSuccess.ok({ skipped: 'payment_disabled' }).toNextResponse()

  const { secretKey } = getServerPaymentConfig()
  // 환불 통지는 스윕 루프 안에서 기다리지 않는다. 한 리워드가 통째로 매진된
  // 뒤 승인이 몰려 들어오면 통지가 건수만큼 늘어나, 정리 자체가 제 수명
  // (`maxDuration`)을 넘길 수 있다. 모아 두었다가 응답 뒤에 **간격을 두고**
  // 하나씩 보낸다 — 메일 제공자가 초당 두 통만 받는다.
  const refundNotices: (() => Promise<void>)[] = []
  // 유실된 승인을 크론이 대신 확정한 건의 "후원이 완료됐습니다" 통지. 확정
  // 라우트(`/api/funding/pledges/confirm`)는 확정 직후 `notifyPledgePaid`를
  // 부르는데, 그 요청이 죽어서 여기까지 온 건은 **아무 통지도 받지 못했다** —
  // 후원자는 돈이 빠져나간 것만 보고 후원번호도 모른 채 남고, 개설자는 후원이
  // 들어온 줄 모른다. 같은 통지를 여기서도 보낸다. 환불 통지와 같은 이유로
  // 스윕 루프 안에서 기다리지 않고 모아 두었다가 응답 뒤에 간격을 두고 낸다.
  const paidNotices: (() => Promise<void>)[] = []
  // 하루 넘게 풀리지 않은 선점이 있으면 `reportStuck`이 채운다. 응답 뒤에
  // 관리자에게 알린다(아래 `after()`).
  let stuckToReport: { count: number; orderIds: string[] } | null = null
  const result = await runExpiryGuard({
    listExpiredHolds: () => listExpiredHolds(),
    lookupPayment: async orderId => {
      // confirm 라우트가 승인 호출 *전에* `recordPaymentKey`로 식별자를 이미
      // 새긴다(대기 상태인 행에만). 그래서 원장에 payment_key가 없다는 것은
      // "승인 응답이 유실됐다"가 아니라 "승인 요청 자체가 나간 적이 없다"는
      // 뜻이다 — 이 경우엔 조회할 결제가 토스에도 없으므로 `not_found`로
      // 답하고 그대로 만료시키는 것이 맞다. payment_key가 있는데 confirm이
      // 유실된 건만 이 아래에서 실제로 조회한다.
      const payment = await getPaymentByOrderId(orderId)
      if (!payment?.payment_key) return 'not_found'
      try {
        const p = await lookupPayment(String(payment.payment_key), { secretKey })
        if (!p) return 'not_found'
        // 대기 상태인 원장 행의 payment_key는 confirm 라우트가 승인 호출
        // *전에* 클라이언트가 보낸 값을 그대로 새긴 것이다(유실된 승인을
        // 구하기 위한 조치) — 즉 검증된 승인에서 나왔다는 보장이 없다.
        // 자신의 대기 후원에 남의 이미 승인된 결제의 paymentKey를 실어
        // 보내면, confirm의 토스 승인 호출은 "이미 처리됨"으로 실패해
        // 정리되는 게 정상이지만 그 요청이 도중에 죽으면(타임아웃·인스턴스
        // 종료) payment_key가 대기 행에 남는다. 다음 스윕이 이걸 그대로
        // 승격시키면 남의 결제를 자기 후원으로 가로챈다. 그래서 토스가
        // 말하는 결제가 *이 주문의 결제가 맞는지*를 승격 전에 반드시
        // 확인한다 — 주문번호와 금액이 우리 원장과 일치해야만 믿는다.
        const tossOrderId = typeof p.orderId === 'string' ? p.orderId : null
        const tossTotalAmount = Number(p.totalAmount)
        const expectedAmount = Number(payment.amount)
        if (
          tossOrderId !== orderId ||
          !Number.isFinite(tossTotalAmount) ||
          tossTotalAmount !== expectedAmount
        ) {
          log.error('스윕 대상 결제가 이 주문의 것이 아님', {
            orderId,
            paymentKey: payment.payment_key,
            expectedOrderId: orderId,
            receivedOrderId: tossOrderId,
            expectedAmount,
            receivedAmount: tossTotalAmount,
          })
          // 주문번호가 다르면 **우리 주문으로 승인된 결제가 없다**는 뜻이다
          // (confirm은 승인 호출 전에 클라이언트가 보낸 식별자를 그대로
          // 새기므로, 그 식별자가 남의 것이면 우리 승인은 애초에 나가지
          // 못했다). 다시 물어도 답이 같으니 보류하지 않는다 — 보류하면 이
          // 행이 다음 스윕의 창을 영영 먹는다.
          //
          // 주문번호는 맞는데 금액이 어긋나는 쪽은 다르다. 그 결제는 우리
          // 것이고 승인됐을 수 있어 만료시키면 돈이 뜬다. 사람이 봐야 한다.
          return tossOrderId !== orderId ? 'mismatch' : 'unknown'
        }
        return {
          status: String(p.status),
          paymentKey: String(p.paymentKey),
          method: typeof p.method === 'string' ? p.method : undefined,
          approvedAt: typeof p.approvedAt === 'string' ? p.approvedAt : undefined,
        }
      } catch (error) {
        if (error instanceof TossLookupError) return 'unknown'
        if (error instanceof TossApiError && error.status === 404) return 'not_found'
        throw error
      }
    },
    promote: async (pledge, lookup) => {
      const orderId = String(pledge.order_id)
      const pledgeId = String(pledge.id)
      let confirmed
      try {
        confirmed = await finalizePledgePayment({
          orderId,
          pledgeId,
          paymentKey: lookup.paymentKey,
          method: lookup.method ?? null,
          approvedAt: lookup.approvedAt ? new Date(lookup.approvedAt) : new Date(),
          raw: { promotedBy: 'expiry-guard' },
        })
      } catch (error) {
        // 승인은 났는데 승격할 자리가 없다. 이 경로는 승인 열 시간이 지나
        // 도착하므로 그사이 마지막 수량이 팔렸거나 프로젝트가 마감됐을 수
        // 있다 — 확정 트랜잭션이 그걸 보고 거절한다. 여기서 그냥 미뤄 두면
        // 후원자는 돈만 낸 채 남는다. 확정 라우트와 같은 처리를 한다:
        // 전액 환불 → 선점 정리 → 원장에 사유 기록.
        if (error instanceof PledgeStockUnavailableError) {
          let refunded = true
          try {
            await cancelPayment(
              lookup.paymentKey,
              { cancelReason: '후원 확정 불가 — 전액 환불', orderId },
              { secretKey }
            )
          } catch (refundError) {
            refunded = false
            log.error('크론 자동 환불 실패 — 수동 처리 필요', {
              orderId,
              pledgeId,
              error: refundError instanceof Error ? refundError.message : refundError,
            })
          }
          await cancelPendingPledge(pledgeId, orderId)
          await markPaymentFailed(orderId, {
            code: error.reason === 'campaign_closed' ? 'CAMPAIGN_CLOSED' : 'REWARD_SOLD_OUT',
            message: refunded
              ? '후원을 확정할 자리가 없어 승인된 결제를 전액 환불했습니다.'
              : '후원을 확정할 자리가 없으나 자동 환불에 실패했습니다. 수동 환불이 필요합니다.',
          })
          log.error('크론 승격 불가 — 승인 후 환불', {
            orderId,
            pledgeId,
            reason: error.reason,
            refunded,
          })
          // 돈이 빠져나갔다가 돌아온 사람에게 이유를 알린다. 지금까지 이
          // 경로는 아무에게도 말하지 않았다 — 결제되고 환불된 것만 통장에
          // 남는다. 자동 환불이 실패한 건은 보내지 않는다: 문장이 "전액
          // 환불했습니다"라 아직 사실이 아니고, 그 건은 위 로그를 보고
          // 사무국이 손으로 처리한 뒤 알린다. 알림 실패가 크론을 멈추지
          // 않도록 여기서도 삼킨다.
          if (refunded) {
            refundNotices.push(() =>
              notifyPledgeRefunded(
                pledge,
                error.reason === 'campaign_closed' ? 'campaign_closed' : 'reward_sold_out'
              ).catch(e => log.error('환불 알림 실패', { orderId, e }))
            )
          }
          return false
        }
        throw error
      }
      if (confirmed) {
        log.warn('유실된 승인을 크론이 확정', { orderId: pledge.order_id })
        const paid = confirmed
        paidNotices.push(() =>
          notifyPledgePaid(paid).catch(e => log.error('후원 완료 알림 실패', { orderId, e }))
        )
      }
      return Boolean(confirmed)
    },
    expire: expirePledge,
    listStuckHolds: () => listStuckHolds(),
    // 하루가 지나도 풀리지 않은 선점은 자동으로 어느 쪽인지 정할 수 없다
    // (승인된 돈이 붙어 있을 수 있다). 조용히 두지 않고 높은 심각도로 남겨
    // 사람이 손으로 확인하게 한다.
    reportStuck: pledges => {
      const ids = pledges.slice(0, 20).map(p => String(p.order_id))
      log.error('하루 넘게 풀리지 않은 선점 — 손으로 확인 필요', {
        count: pledges.length,
        orderIds: ids,
      })
      logSecurityEvent(
        'FUNDING_STUCK_PENDING_HOLDS',
        { count: pledges.length, orderIds: ids },
        'high'
      )
      // 응답 뒤에 관리자에게 알리려고 담아 둔다. 로그는 여기서 아무도 보지
      // 않으므로 사람에게 닿는 통로가 따로 있어야 한다.
      stuckToReport = { count: pledges.length, orderIds: ids }
    },
  })

  if (stuckToReport) {
    // 하루 한 번만 낸다(`notifyStuckHolds`가 최근 공지를 보고 스스로 거른다).
    // 알림 함수는 스스로 삼키지만 `after()` 안에서 새는 예외는 잡아 줄 사람이
    // 없으므로 한 번 더 잡는다.
    const stuck = stuckToReport
    after(() => notifyStuckHolds(stuck).catch(e => log.error('정체 선점 알림 실패', e)))
  }

  if (paidNotices.length > 0) {
    // 환불 통지와 같은 속도 제한(초당 2통)을 탄다.
    after(() => sendNoticesPaced(paidNotices, { log }).then(r => log.info('확정 통지 발송', r)))
  }

  if (refundNotices.length > 0) {
    // 메일 제공자가 받아 주는 속도(초당 2통)에 맞춰 하나씩 보낸다. 한꺼번에
    // 띄우면 429가 돌아오고, 그건 "돈은 돌아갔는데 아무도 모른다"가 된다.
    after(() => sendNoticesPaced(refundNotices, { log }).then(r => log.info('환불 통지 발송', r)))
  }

  log.info('후원 만료 정리', result)
  return ApiSuccess.ok(result).toNextResponse()
}

export const GET = handle
export const POST = handle
