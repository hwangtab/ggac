/**
 * 후원 쿼리 계층. 티켓 예매(`ticketing.ts`)와 같은 뼈대 — 재고를 먼저 잡고,
 * 승인이 끝나면 확정하며, 주문번호(`order_id`)가 결제와 후원을 잇는 유일한 고리다.
 */

import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { fundingPledges, fundingRewards, payments } from '../schema/index.ts'
import { computePledgeTotal } from '../../lib/funding/amounts.ts'
import { generatePledgeCode } from '../../lib/funding/pledgeCode.ts'

import { toIso, toSnakeCase } from './_helpers.ts'

type Row = Record<string, unknown>

export const DEFAULT_HOLD_MINUTES = 10

export class RewardSoldOutError extends Error {
  remaining: number
  constructor(remaining: number) {
    super(remaining > 0 ? `남은 수량이 ${remaining}개뿐입니다.` : '준비된 수량이 모두 소진되었습니다.')
    this.name = 'RewardSoldOutError'
    this.remaining = remaining
  }
}

/**
 * 이 프로젝트의 환불은 전부 전액 환불이다. 부분 환불을 모델링하려면 후원에
 * "일부만 환불됨" 상태와 남은 금액이 따로 있어야 하는데 그 상태가 아직
 * 없다 — 조용히 절반만 처리하고 `refunded`로 넘겨버리면 원장의 누적
 * 취소액이 실제보다 적게 남고(다음 부분 환불이 매칭할 상태를 잃는다), 재고도
 * 전액 환불처럼 통째로 풀리고, 후원자는 실제로는 일부만 돌려받았는데
 * "환불 완료"로 보인다. 지원하지 못하는 입력은 조용히 잘못 처리하는 것보다
 * 시끄럽게 거부하는 편이 낫다. 제대로 된 부분 환불은 이후 관리자 환불
 * 화면과 함께 들어온다.
 */
export class PartialRefundUnsupportedError extends Error {
  totalAmount: number
  canceledAmount: number
  constructor(totalAmount: number, canceledAmount: number) {
    super(`부분 환불은 아직 지원하지 않습니다. 후원 금액 ${totalAmount}원 중 ${canceledAmount}원만 취소 요청됐습니다.`)
    this.name = 'PartialRefundUnsupportedError'
    this.totalAmount = totalAmount
    this.canceledAmount = canceledAmount
  }
}

const DATE_KEYS = ['holdExpiresAt', 'paidAt', 'canceledAt', 'refundedAt', 'termsAgreedAt', 'privacyAgreedAt', 'createdAt', 'updatedAt'] as const

function rowToPledge(row: Row): Row {
  const snake = toSnakeCase(row)
  for (const key of DATE_KEYS) {
    snake[key.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)] = toIso(row[key] as Date | null)
  }
  return snake
}

/** 재고를 차지하는 후원: paid이거나 아직 만료되지 않은 pending. */
function occupyingCondition(now: Date) {
  return or(
    eq(fundingPledges.status, 'paid'),
    and(
      eq(fundingPledges.status, 'pending'),
      or(isNull(fundingPledges.holdExpiresAt), gt(fundingPledges.holdExpiresAt, now))
    )
  )
}

export async function getRemainingQuantity(rewardId: string, now: Date = new Date()): Promise<number | null> {
  const [reward] = await db
    .select({ total: fundingRewards.totalQuantity })
    .from(fundingRewards)
    .where(eq(fundingRewards.id, rewardId))
    .limit(1)
  if (!reward || reward.total === null) return null
  const [taken] = await db
    .select({ total: sql<number>`COALESCE(SUM(${fundingPledges.quantity}), 0)` })
    .from(fundingPledges)
    .where(and(eq(fundingPledges.rewardId, rewardId), occupyingCondition(now)))
  return Math.max(0, Number(reward.total) - Number(taken?.total ?? 0))
}

export interface HoldPledgeInput {
  order_id: string
  campaign_id: string
  reward_id: string
  user_id: string | null
  quantity: number
  additional_amount: number
  backer_name: string
  backer_email: string
  backer_phone?: string | null
  is_anonymous?: boolean
  supporter_message?: string | null
  message_public?: boolean
  shipping?: {
    name: string
    phone: string
    postcode: string
    address1: string
    address2?: string | null
    memo?: string | null
  } | null
  terms_version?: string | null
  hold_minutes?: number
}

function isLockContention(error: unknown): boolean {
  const code = (error as { code?: string })?.code
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return true
  const message = error instanceof Error ? error.message : String(error)
  return /SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(message)
}

/** 락 경합만 재시도한다. 매진은 다시 해도 같다. */
export async function holdPledge(input: HoldPledgeInput): Promise<Row> {
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await holdPledgeOnce(input)
    } catch (error) {
      if (error instanceof RewardSoldOutError) throw error
      if (!isLockContention(error)) throw error
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
  throw lastError
}

async function holdPledgeOnce(input: HoldPledgeInput): Promise<Row> {
  const now = new Date()
  const holdMinutes = input.hold_minutes ?? DEFAULT_HOLD_MINUTES

  return db.transaction(async tx => {
    const [reward] = await tx
      .select({ title: fundingRewards.title, amount: fundingRewards.amount, total: fundingRewards.totalQuantity, campaignId: fundingRewards.campaignId })
      .from(fundingRewards)
      .where(eq(fundingRewards.id, input.reward_id))
      .limit(1)
    if (!reward || reward.campaignId !== input.campaign_id) throw new Error('리워드를 찾을 수 없습니다.')

    if (reward.total !== null) {
      const [taken] = await tx
        .select({ total: sql<number>`COALESCE(SUM(${fundingPledges.quantity}), 0)` })
        .from(fundingPledges)
        .where(and(eq(fundingPledges.rewardId, input.reward_id), occupyingCondition(now)))
      const remaining = Math.max(0, Number(reward.total) - Number(taken?.total ?? 0))
      if (input.quantity > remaining) throw new RewardSoldOutError(remaining)
    }

    const totalAmount = computePledgeTotal({
      unitAmount: Number(reward.amount),
      quantity: input.quantity,
      additionalAmount: input.additional_amount,
    })

    const rows = await tx
      .insert(fundingPledges)
      .values({
        pledgeCode: generatePledgeCode(now),
        campaignId: input.campaign_id,
        rewardId: input.reward_id,
        userId: input.user_id,
        orderId: input.order_id,
        backerName: input.backer_name,
        backerEmail: input.backer_email,
        backerPhone: input.backer_phone ?? null,
        rewardTitle: reward.title,
        unitAmount: Number(reward.amount),
        quantity: input.quantity,
        additionalAmount: input.additional_amount,
        totalAmount,
        status: 'pending',
        holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
        isAnonymous: input.is_anonymous ?? false,
        supporterMessage: input.supporter_message ?? null,
        messagePublic: input.message_public ?? false,
        shippingName: input.shipping?.name ?? null,
        shippingPhone: input.shipping?.phone ?? null,
        shippingPostcode: input.shipping?.postcode ?? null,
        shippingAddress1: input.shipping?.address1 ?? null,
        shippingAddress2: input.shipping?.address2 ?? null,
        shippingMemo: input.shipping?.memo ?? null,
        termsVersion: input.terms_version ?? null,
        termsAgreedAt: now,
        privacyAgreedAt: now,
      })
      .returning()
    return rowToPledge(rows[0] as Row)
  })
}

/**
 * 결제 확정과 후원 확정, 리워드 잠금을 한 트랜잭션으로.
 * `order_id`가 WHERE에 들어가는 것이 핵심 — 짝이 안 맞으면 0행이고 결제도 안 바뀐다.
 */
export async function finalizePledgePayment(input: {
  orderId: string
  pledgeId: string
  paymentKey: string
  method: string | null
  approvedAt: Date
  raw: unknown
}): Promise<Row | null> {
  return db.transaction(async tx => {
    const [payment] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.orderId, input.orderId)).limit(1)
    if (!payment) return null

    const [confirmed] = await tx
      .update(fundingPledges)
      .set({ status: 'paid', paymentId: payment.id, paidAt: input.approvedAt, holdExpiresAt: null })
      .where(and(eq(fundingPledges.id, input.pledgeId), eq(fundingPledges.orderId, input.orderId), eq(fundingPledges.status, 'pending')))
      .returning()
    if (!confirmed) {
      // 더블클릭·재시도. 같은 주문으로 이미 확정됐으면 성공으로 답한다.
      const [already] = await tx
        .select()
        .from(fundingPledges)
        .where(and(eq(fundingPledges.id, input.pledgeId), eq(fundingPledges.orderId, input.orderId), eq(fundingPledges.status, 'paid')))
        .limit(1)
      return already ? rowToPledge(already as Row) : null
    }

    await tx
      .update(payments)
      .set({ status: 'done', paymentKey: input.paymentKey, method: input.method, approvedAt: input.approvedAt, rawResponse: input.raw, failureCode: null, failureMessage: null })
      .where(eq(payments.id, payment.id))

    // 의도적으로 인라인이다: 이 트랜잭션 핸들(tx) 위에서 실행돼야 하므로
    // 모듈 수준 커넥션을 닫는 별도 헬퍼로 뺄 수 없다 — 뺐다면 이 확정과
    // 다른 트랜잭션이었을 커밋 시점을 가진다.
    await tx
      .update(fundingRewards)
      .set({ lockedAt: input.approvedAt })
      .where(and(eq(fundingRewards.id, confirmed.rewardId), isNull(fundingRewards.lockedAt)))

    return rowToPledge(confirmed as Row)
  })
}

/** 취소 선점: `paid → canceled`. 0행이면 이미 다른 요청이 잡았거나 취소 불가 상태다. */
export async function claimPledgeForCancel(
  pledgeId: string,
  options: { requireFulfillmentNone?: boolean }
): Promise<Row | null> {
  const conditions = [eq(fundingPledges.id, pledgeId), eq(fundingPledges.status, 'paid')]
  if (options.requireFulfillmentNone) conditions.push(eq(fundingPledges.fulfillmentStatus, 'none'))
  const [row] = await db
    .update(fundingPledges)
    .set({ status: 'canceled', canceledAt: new Date() })
    .where(and(...conditions))
    .returning()
  return row ? rowToPledge(row as Row) : null
}

/**
 * 취소 선점을 되돌린다(토스 거절 시). `canceled`이기만 하면 되돌리는 것으로는
 * 부족하다 — `cancelPendingPledge`도 같은 `canceled` 상태를 만드는데, 그건
 * `pending`에서 결제 한 번 없이 온 것이다. 그 id로 이 함수를 부르면 결제
 * 연결도 결제 시각도 없는 후원이 `paid`가 되어 재고를 팔린 것처럼 차지하고
 * 공개 명단에 빈 날짜로 나타난다. 실제로 결제가 붙었던(= `payment_id`가
 * 있는) 후원만 되돌린다.
 */
export async function revertPledgeCancel(pledgeId: string): Promise<void> {
  await db
    .update(fundingPledges)
    .set({ status: 'paid', canceledAt: null })
    .where(
      and(
        eq(fundingPledges.id, pledgeId),
        eq(fundingPledges.status, 'canceled'),
        isNotNull(fundingPledges.paymentId)
      )
    )
}

/** 토스 환불이 끝난 뒤. 후원 `refunded`와 원장 누적 취소액을 한 트랜잭션으로. */
export async function finalizePledgeRefund(input: {
  orderId: string
  paymentId: string
  pledgeId: string
  canceledAmount: number
  raw: unknown
}): Promise<Row | null> {
  return db.transaction(async tx => {
    const [pledge] = await tx
      .select({ totalAmount: fundingPledges.totalAmount })
      .from(fundingPledges)
      .where(and(eq(fundingPledges.id, input.pledgeId), eq(fundingPledges.paymentId, input.paymentId)))
      .limit(1)
    if (!pledge) return null
    // 이 프로젝트의 환불은 전액뿐이다 — 후원 총액에 못 미치는 취소액은
    // 아무것도 쓰지 않고 시끄럽게 거부한다(위 클래스 주석 참고).
    if (input.canceledAmount < pledge.totalAmount) {
      throw new PartialRefundUnsupportedError(pledge.totalAmount, input.canceledAmount)
    }

    const [refunded] = await tx
      .update(fundingPledges)
      .set({ status: 'refunded', refundedAt: new Date() })
      .where(and(eq(fundingPledges.id, input.pledgeId), eq(fundingPledges.paymentId, input.paymentId), inArray(fundingPledges.status, ['paid', 'canceled'])))
      .returning()
    if (!refunded) return null
    await tx
      .update(payments)
      .set({
        canceledAmount: input.canceledAmount,
        status: sql`CASE WHEN ${input.canceledAmount} >= ${payments.amount} THEN 'canceled' ELSE 'partial_canceled' END`,
        rawResponse: input.raw,
      })
      .where(and(eq(payments.orderId, input.orderId), sql`${payments.canceledAmount} < ${input.canceledAmount}`))
    return rowToPledge(refunded as Row)
  })
}

/** 승인이 확실히 거절됐을 때. 주문 짝이 맞는 pending만 취소한다. */
export async function cancelPendingPledge(pledgeId: string, expectedOrderId: string): Promise<Row | null> {
  const [row] = await db
    .update(fundingPledges)
    .set({ status: 'canceled', canceledAt: new Date() })
    .where(and(eq(fundingPledges.id, pledgeId), eq(fundingPledges.orderId, expectedOrderId), eq(fundingPledges.status, 'pending')))
    .returning()
  return row ? rowToPledge(row as Row) : null
}

export async function listExpiredHolds(now: Date = new Date(), limit = 100): Promise<Row[]> {
  const rows = await db
    .select()
    .from(fundingPledges)
    .where(and(eq(fundingPledges.status, 'pending'), lte(fundingPledges.holdExpiresAt, now)))
    .limit(limit)
  return rows.map(r => rowToPledge(r as Row))
}

export async function expirePledge(pledgeId: string): Promise<boolean> {
  const rows = await db
    .update(fundingPledges)
    .set({ status: 'expired' })
    .where(and(eq(fundingPledges.id, pledgeId), eq(fundingPledges.status, 'pending')))
    .returning({ id: fundingPledges.id })
  return rows.length > 0
}

export async function getPledgeById(id: string): Promise<Row | null> {
  const rows = await db.select().from(fundingPledges).where(eq(fundingPledges.id, id)).limit(1)
  return rows[0] ? rowToPledge(rows[0] as Row) : null
}

export async function getPledgeByOrderId(orderId: string): Promise<Row | null> {
  const rows = await db.select().from(fundingPledges).where(eq(fundingPledges.orderId, orderId)).limit(1)
  return rows[0] ? rowToPledge(rows[0] as Row) : null
}

/** 비회원 본인 확인. 이메일은 대소문자를 가리지 않는다. */
export async function getPledgeByCodeAndEmail(code: string, email: string): Promise<Row | null> {
  const rows = await db
    .select()
    .from(fundingPledges)
    .where(and(eq(fundingPledges.pledgeCode, code), sql`lower(${fundingPledges.backerEmail}) = lower(${email})`))
    .limit(1)
  return rows[0] ? rowToPledge(rows[0] as Row) : null
}

export async function listPledgesByUser(userId: string): Promise<Row[]> {
  const rows = await db.select().from(fundingPledges).where(eq(fundingPledges.userId, userId)).orderBy(desc(fundingPledges.createdAt))
  return rows.map(r => rowToPledge(r as Row))
}

export async function listPledgesByCampaign(campaignId: string, filter: { status?: string } = {}): Promise<Row[]> {
  const conditions = [eq(fundingPledges.campaignId, campaignId)]
  if (filter.status) conditions.push(eq(fundingPledges.status, filter.status as (typeof fundingPledges.$inferSelect)['status']))
  const rows = await db.select().from(fundingPledges).where(and(...conditions)).orderBy(desc(fundingPledges.createdAt))
  return rows.map(r => rowToPledge(r as Row))
}

/** 공개 명단. 개인정보는 여기서부터 나가지 않는다 — 이름(또는 '익명')과 공개 메시지뿐. */
export async function listPublicBackers(
  campaignId: string,
  limit = 100
): Promise<{ name: string; message: string | null; paid_at: string }[]> {
  const rows = await db
    .select({
      name: fundingPledges.backerName,
      anonymous: fundingPledges.isAnonymous,
      message: fundingPledges.supporterMessage,
      messagePublic: fundingPledges.messagePublic,
      paidAt: fundingPledges.paidAt,
    })
    .from(fundingPledges)
    .where(and(eq(fundingPledges.campaignId, campaignId), eq(fundingPledges.status, 'paid')))
    .orderBy(desc(fundingPledges.paidAt))
    .limit(limit)
  return rows.map(r => ({
    name: r.anonymous ? '익명' : r.name,
    message: r.messagePublic ? (r.message ?? null) : null,
    paid_at: toIso(r.paidAt) ?? '',
  }))
}
