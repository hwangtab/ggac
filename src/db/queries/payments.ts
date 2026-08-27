/**
 * 결제 원장·월별 회비 쿼리 계층 (Turso/Drizzle).
 *
 * `profiles.ts`와 같은 규칙을 따른다 — **권한을 모르고**, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 인증·인가는 호출부의
 * 몫이고 여기는 이미 검증된 id만 받는다. 응답 키는 snake_case다.
 *
 * 이 계층의 갱신 함수는 전부 **조건부 UPDATE**다. "읽고 판단한 뒤 쓰기"로
 * 짜면 승인 응답과 웹훅이 겹쳐 도착할 때 나중 것이 먼저 것을 덮어쓴다.
 * 토스는 웹훅을 최대 7번 재전송하므로 이건 예외 상황이 아니라 일상이다.
 */

import { and, asc, eq, lt, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { membershipDues, payments } from '../schema/index.ts'

import { toIso, toSnakeCase } from './_helpers.ts'

export type PaymentKind = 'dues' | 'ticket'

export interface CreatePendingPaymentInput {
  orderId: string
  userId: string | null
  kind: PaymentKind
  orderName: string
  amount: number
  payerName?: string | null
  payerEmail?: string | null
}

export interface MarkPaymentDoneInput {
  paymentKey: string
  method?: string | null
  /** ISO 문자열. 토스 응답의 `approvedAt`을 그대로 넘긴다. */
  approvedAt: string
  raw: unknown
}

function rowToPayment(row: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnakeCase(row)
  snake.approved_at = toIso(row.approvedAt as Date | null)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  return snake
}

function rowToDues(row: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnakeCase(row)
  snake.paid_at = toIso(row.paidAt as Date | null)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  return snake
}

/**
 * 결제창을 띄우기 **전에** 대기 행을 남긴다.
 *
 * 순서가 중요하다. 결제창을 먼저 띄우면 "토스에는 승인됐는데 우리 원장에는
 * 없는" 건이 생기고, 그건 사후에 대사로도 찾기 어렵다(우리가 만든 주문번호를
 * 모르니 조회할 것도 없다).
 *
 * 주문번호가 겹치면 UNIQUE 제약이 던진다 — 호출부는 그 예외를 삼키지 말 것.
 */
export async function createPendingPayment(
  input: CreatePendingPaymentInput
): Promise<Record<string, unknown>> {
  const rows = await db
    .insert(payments)
    .values({
      orderId: input.orderId,
      userId: input.userId,
      kind: input.kind,
      orderName: input.orderName,
      amount: input.amount,
      payerName: input.payerName ?? null,
      payerEmail: input.payerEmail ?? null,
      status: 'pending',
    })
    .returning()
  return rowToPayment(rows[0])
}

export async function getPaymentByOrderId(
  orderId: string
): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(payments).where(eq(payments.orderId, orderId)).limit(1)
  return rows[0] ? rowToPayment(rows[0]) : null
}

export async function getPaymentById(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(payments).where(eq(payments.id, id)).limit(1)
  return rows[0] ? rowToPayment(rows[0]) : null
}

/**
 * 승인 확정. **대기 상태인 행만** 바꾼다.
 *
 * 이미 확정된 행을 다시 확정하지 않는 이유: 승인 응답과 웹훅이 겹쳐 도착하면
 * 나중 것이 승인 시각과 결제수단을 덮어써, 원장의 승인 시각이 실제보다 뒤로
 * 밀린다. 첫 확정이 정본이다.
 */
export async function markPaymentDone(
  orderId: string,
  input: MarkPaymentDoneInput
): Promise<Record<string, unknown> | null> {
  await db
    .update(payments)
    .set({
      status: 'done',
      paymentKey: input.paymentKey,
      method: input.method ?? null,
      approvedAt: new Date(input.approvedAt),
      rawResponse: input.raw,
      failureCode: null,
      failureMessage: null,
    })
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'pending')))
  return getPaymentByOrderId(orderId)
}

/**
 * 실패 기록. **대기 상태인 행만** 바꾼다.
 *
 * 승인된 결제를 실패로 뒤집으면 받은 돈이 장부에서 사라진다. 늦게 도착한
 * 실패 통지는 무시하는 게 맞다 — 실제로 취소된 것이라면 취소 경로로 온다.
 */
export async function markPaymentFailed(
  orderId: string,
  input: { code: string; message: string }
): Promise<Record<string, unknown> | null> {
  await db
    .update(payments)
    .set({
      status: 'failed',
      failureCode: input.code,
      failureMessage: input.message,
    })
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'pending')))
  return getPaymentByOrderId(orderId)
}

/**
 * 취소를 기록한다. `canceledAmount`는 **누적 취소 총액**이다(더할 값이 아니라).
 *
 * 더하는 방식으로 짜면 웹훅 재전송마다 금액이 불어나 환불액이 결제액을 넘는다.
 * 또 웹훅은 순서를 보장하지 않으므로, 이미 기록된 금액보다 **작은** 통지는
 * 낡은 것으로 보고 무시한다.
 */
export async function recordPaymentCancel(
  orderId: string,
  input: { canceledAmount: number; raw: unknown }
): Promise<Record<string, unknown> | null> {
  await db
    .update(payments)
    .set({
      canceledAmount: input.canceledAmount,
      status: sql`CASE WHEN ${input.canceledAmount} >= ${payments.amount} THEN 'canceled' ELSE 'partial_canceled' END`,
      rawResponse: input.raw,
    })
    .where(and(eq(payments.orderId, orderId), lt(payments.canceledAmount, input.canceledAmount)))
  return getPaymentByOrderId(orderId)
}

// ------------------------------------------------------------------ 월별 회비

/**
 * 청구월 행을 보장한다. 이미 있으면 **그대로 둔다**.
 *
 * 금액을 덮어쓰지 않는 이유: 청구서를 보낸 뒤 회원이 회비 설정을 바꿔도 그
 * 달 청구액은 이미 고지된 값이어야 한다. 바꾸려면 명시적으로 다른 함수를
 * 쓰게 한다.
 */
export async function ensureDues(input: {
  userId: string
  billingMonth: string
  amount: number
}): Promise<Record<string, unknown>> {
  await db
    .insert(membershipDues)
    .values({
      userId: input.userId,
      billingMonth: input.billingMonth,
      amount: input.amount,
      status: 'unpaid',
    })
    .onConflictDoNothing()
  const row = await getDues(input.userId, input.billingMonth)
  return row as Record<string, unknown>
}

export async function getDues(
  userId: string,
  billingMonth: string
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(membershipDues)
    .where(and(eq(membershipDues.userId, userId), eq(membershipDues.billingMonth, billingMonth)))
    .limit(1)
  return rows[0] ? rowToDues(rows[0]) : null
}

/** 테스트와 진단용. 청구월 유일성이 실제로 지켜지는지 세어 본다. */
export async function countDues(userId: string, billingMonth: string): Promise<number> {
  const rows = await db
    .select({ id: membershipDues.id })
    .from(membershipDues)
    .where(and(eq(membershipDues.userId, userId), eq(membershipDues.billingMonth, billingMonth)))
  return rows.length
}

/**
 * 납부 처리. **미납인 행만** 바꾼다 — 이미 납부된 달을 다시 납부로 덮어써
 * 결제 연결이 바뀌면, 어느 결제로 냈는지 추적이 끊긴다.
 */
export async function markDuesPaid(input: {
  userId: string
  billingMonth: string
  paymentId: string
}): Promise<Record<string, unknown> | null> {
  await db
    .update(membershipDues)
    .set({ status: 'paid', paymentId: input.paymentId, paidAt: new Date() })
    .where(
      and(
        eq(membershipDues.userId, input.userId),
        eq(membershipDues.billingMonth, input.billingMonth),
        eq(membershipDues.status, 'unpaid')
      )
    )
  return getDues(input.userId, input.billingMonth)
}

/** 해당 청구월에 아직 안 낸 행. 매월 청구 크론이 대상자를 찾는 경로다. */
export async function listUnpaidDues(billingMonth: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(membershipDues)
    .where(and(eq(membershipDues.billingMonth, billingMonth), eq(membershipDues.status, 'unpaid')))
    .orderBy(asc(membershipDues.createdAt))
  return rows.map(rowToDues)
}

/** 한 회원의 결제 내역. 마이페이지 영수증 목록에 쓴다. */
export async function listPaymentsByUser(
  userId: string,
  limit = 50
): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.userId, userId))
    .orderBy(asc(payments.createdAt))
    .limit(limit)
  return rows.map(rowToPayment)
}
