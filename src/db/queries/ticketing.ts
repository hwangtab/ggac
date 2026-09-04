/**
 * 공연 예매 쿼리 계층 (Turso/Drizzle).
 *
 * `payments.ts`와 같은 규칙 — 권한을 모르고, 검증된 id만 받고, 응답 키는
 * snake_case다.
 *
 * 이 계층의 중심은 **재고**다. 티켓은 수량이 한정돼 있어서, 마지막 한 장을
 * 두 사람이 동시에 사려는 상황을 반드시 막아야 한다. 초과 판매는 환불로도
 * 되돌릴 수 없다 — 공연 당일 입장을 거절해야 하는 사고가 된다.
 */

import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  payments,
  performanceShows,
  performances,
  reservations,
  ticketTypes,
} from '../schema/index.ts'

import { toIso, toSnakeCase } from './_helpers.ts'

/** 결제창을 열어 두고 사라진 사람의 자리를 언제까지 잡아 둘지. 토스 인증 유효시간과 맞춘다. */
export const DEFAULT_HOLD_MINUTES = 10

export class SoldOutError extends Error {
  remaining: number

  constructor(remaining: number) {
    super(remaining > 0 ? `남은 좌석이 ${remaining}석뿐입니다.` : '남은 좌석이 없습니다.')
    this.name = 'SoldOutError'
    this.remaining = remaining
  }
}

function rowToReservation(row: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnakeCase(row)
  snake.hold_expires_at = toIso(row.holdExpiresAt as Date | null)
  snake.canceled_at = toIso(row.canceledAt as Date | null)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  return snake
}

function rowToShow(row: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnakeCase(row)
  snake.starts_at = toIso(row.startsAt as Date | null)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  return snake
}

/**
 * 사람이 전화로 부를 수 있는 예매번호.
 *
 * 헷갈리는 글자(0/O, 1/I)를 뺀 문자만 쓴다 — 현장에서 예매번호를 불러 대조할
 * 때 O를 0으로 잘못 듣는 일이 실제로 생긴다.
 */
function generateReservationCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ''
  for (const byte of bytes) code += alphabet[byte % alphabet.length]
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * 자리를 차지하고 있는 예매만 고르는 조건.
 *
 * `confirmed`는 당연히 자리를 차지하고, **아직 만료되지 않은 `pending`도**
 * 차지한다 — 결제 중인 사람의 자리를 남에게 팔 수는 없다. 만료된 `pending`은
 * 결제하지 않고 사라진 것이므로 자리를 돌려준다.
 */
function occupyingCondition(now: Date) {
  return or(
    eq(reservations.status, 'confirmed'),
    and(
      eq(reservations.status, 'pending'),
      or(isNull(reservations.holdExpiresAt), gt(reservations.holdExpiresAt, now))
    )
  )
}

/** 이 회차에서 지금 팔 수 있는 좌석 수. */
export async function getRemainingSeats(showId: string, now: Date = new Date()): Promise<number> {
  const [show] = await db
    .select({ capacity: performanceShows.capacity })
    .from(performanceShows)
    .where(eq(performanceShows.id, showId))
    .limit(1)
  if (!show) return 0

  const [taken] = await db
    .select({ total: sql<number>`COALESCE(SUM(${reservations.quantity}), 0)` })
    .from(reservations)
    .where(and(eq(reservations.showId, showId), occupyingCondition(now)))

  return Math.max(0, Number(show.capacity) - Number(taken?.total ?? 0))
}

/**
 * 여러 회차의 남은 좌석을 **한 번에** 센다.
 *
 * 회차마다 `getRemainingSeats`를 부르면 회차 수의 두 배만큼 원격 왕복이 든다
 * (그 함수는 정원과 점유 수량을 따로 읽는다). 공연 상세는 공개 트래픽이 가장
 * 몰리는 경로라 회차가 늘수록 그대로 느려졌다.
 *
 * 정원은 호출자가 이미 손에 쥐고 있으므로 인자로 받는다. 점유 수량만 회차별로
 * 묶어 집계한다.
 *
 * @param capacities 회차 id → 정원.
 * @returns 회차 id → 남은 좌석 수.
 */
export async function getRemainingSeatsByShow(
  capacities: Map<string, number>,
  now: Date = new Date()
): Promise<Map<string, number>> {
  const showIds = [...capacities.keys()]
  const remaining = new Map<string, number>()
  if (showIds.length === 0) return remaining

  const taken = await db
    .select({
      showId: reservations.showId,
      total: sql<number>`COALESCE(SUM(${reservations.quantity}), 0)`,
    })
    .from(reservations)
    .where(and(inArray(reservations.showId, showIds), occupyingCondition(now)))
    .groupBy(reservations.showId)

  const takenByShow = new Map(taken.map(row => [row.showId, Number(row.total)]))
  for (const [showId, capacity] of capacities) {
    remaining.set(showId, Math.max(0, Number(capacity) - (takenByShow.get(showId) ?? 0)))
  }
  return remaining
}

export interface HoldReservationInput {
  showId: string
  ticketTypeId: string
  /**
   * 이 예매에 붙일 결제 주문번호. 선점과 같은 순간에 새겨야 하므로 호출자가
   * 결제 주문을 만들기 **전에** 발급해 넘긴다.
   */
  orderId: string
  userId?: string | null
  bookerName: string
  bookerPhone: string
  bookerEmail?: string | null
  quantity: number
  /** 결제 시점의 단가. 나중에 가격이 바뀌어도 이 예매의 금액은 그대로다. */
  unitPrice: number
  holdMinutes?: number
}

/**
 * 자리를 선점한다. **결제를 시작하기 전에 부른다.**
 *
 * 순서가 중요하다. 결제를 먼저 받고 자리를 잡으면, 매진된 회차의 표를 팔고
 * 나서 환불해야 하는 상황이 생긴다.
 *
 * 재고 확인과 INSERT 사이에 다른 요청이 끼어들 수 있으므로 **트랜잭션 안에서**
 * 두 가지를 함께 한다. SQLite는 쓰기를 직렬화하므로 이 트랜잭션이 초과 판매를
 * 막는 실질적인 경계다.
 */
export async function holdReservation(
  input: HoldReservationInput
): Promise<Record<string, unknown>> {
  // 동시 예매가 몰리면 쓰기 락이 부딪혀 일부 요청이 즉시 실패한다. 트랜잭션이
  // 실패하면 아무것도 남기지 않으므로 재시도해도 안전하다 — 여기서 포기하면
  // 좌석이 남아 있는데도 관객이 "예매할 수 없다"는 안내를 받는다.
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await holdReservationOnce(input)
    } catch (error) {
      // 매진은 재시도해도 결과가 같다. 락 경합만 다시 시도한다.
      if (error instanceof SoldOutError) throw error
      if (!isLockContention(error)) throw error
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
  throw lastError
}

/** 락 경합인가. 잠시 뒤 다시 하면 되는 실패와 진짜 오류를 가른다. */
function isLockContention(error: unknown): boolean {
  const code = (error as { code?: string })?.code
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return true
  const message = error instanceof Error ? error.message : String(error)
  return /SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(message)
}

async function holdReservationOnce(input: HoldReservationInput): Promise<Record<string, unknown>> {
  const now = new Date()
  const holdMinutes = input.holdMinutes ?? DEFAULT_HOLD_MINUTES

  return db.transaction(async tx => {
    const [show] = await tx
      .select({ capacity: performanceShows.capacity })
      .from(performanceShows)
      .where(eq(performanceShows.id, input.showId))
      .limit(1)
    if (!show) throw new Error('회차를 찾을 수 없습니다.')

    const [taken] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${reservations.quantity}), 0)` })
      .from(reservations)
      .where(and(eq(reservations.showId, input.showId), occupyingCondition(now)))

    const remaining = Math.max(0, Number(show.capacity) - Number(taken?.total ?? 0))
    if (input.quantity > remaining) throw new SoldOutError(remaining)

    const rows = await tx
      .insert(reservations)
      .values({
        reservationCode: generateReservationCode(),
        showId: input.showId,
        ticketTypeId: input.ticketTypeId,
        orderId: input.orderId,
        userId: input.userId ?? null,
        bookerName: input.bookerName,
        bookerPhone: input.bookerPhone,
        bookerEmail: input.bookerEmail ?? null,
        quantity: input.quantity,
        totalAmount: input.unitPrice * input.quantity,
        status: 'pending',
        holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
      })
      .returning()
    return rowToReservation(rows[0])
  })
}

/**
 * 결제 승인과 좌석 확정을 **한 트랜잭션으로** 끝낸다.
 *
 * 예전에는 결제 상태를 바꾸고, 결제 행을 다시 읽고, 좌석을 확정하는 세 번의
 * 독립 왕복이었다. 중간에 인스턴스가 죽으면 결제는 `done`인데 좌석은
 * `pending`으로 남는다 — 돈만 받고 표를 못 주는 상태다. 라우트에 자동 환불
 * 보상이 있었지만 그것은 **같은 요청이 살아 있을 때만** 돈다.
 *
 * 주문번호로 두 행을 함께 찾아 바꾸므로, 어느 한쪽만 바뀌는 상태가 없다.
 * 좌석 확정 조건에 `order_id`가 들어가는 것이 이 함수의 핵심이다 — 승인 요청이
 * 들고 온 예매 id가 그 주문의 것이 아니면 UPDATE가 0행을 건드리고 실패한다.
 *
 * @returns 확정된 예매. 좌석이 이미 만료·취소됐거나 주문과 예매가 짝이 맞지
 *   않으면 `null`이고, 이때 결제 상태도 바뀌지 않는다(트랜잭션이 되돌린다).
 */
export async function finalizeTicketPayment(input: {
  orderId: string
  reservationId: string
  paymentKey: string
  method: string | null
  approvedAt: Date
  raw: unknown
}): Promise<Record<string, unknown> | null> {
  return db.transaction(async tx => {
    // **읽기와 판단을 먼저, 쓰기는 나중에.** 확정할 수 없는 요청이면 아무것도
    // 쓰지 않은 채로 빠져나온다 — `tx.rollback()`은 예외를 던져 나가므로
    // "못 했다"를 값으로 돌려주는 이 계약과 맞지 않는다.
    const [payment] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.orderId, input.orderId))
      .limit(1)
    if (!payment) return null

    const [confirmed] = await tx
      .update(reservations)
      .set({ status: 'confirmed', paymentId: payment.id, holdExpiresAt: null })
      .where(
        and(
          eq(reservations.id, input.reservationId),
          eq(reservations.orderId, input.orderId),
          eq(reservations.status, 'pending')
        )
      )
      .returning()
    // 좌석을 못 잡았다. 결제는 손대지 않았으므로 라우트가 환불만 하면 된다.
    if (!confirmed) return null

    await tx
      .update(payments)
      .set({
        status: 'done',
        paymentKey: input.paymentKey,
        method: input.method,
        approvedAt: input.approvedAt,
        rawResponse: input.raw,
        failureCode: null,
        failureMessage: null,
      })
      .where(eq(payments.id, payment.id))

    return rowToReservation(confirmed as unknown as Record<string, unknown>)
  })
}

/**
 * 환불 기록과 좌석 반환을 **한 트랜잭션으로** 끝낸다.
 *
 * 토스 환불이 끝난 **뒤에** 부른다. 두 쓰기가 나뉘어 있으면 사이에서 실패했을
 * 때 원장은 `canceled`인데 예매는 `confirmed`로 남는다 — 자리는 영영 잠기고,
 * 회원은 이미 환불받았는데도 취소가 안 됐다고 다시 시도한다.
 *
 * `canceledAmount`는 `recordPaymentCancel`과 같은 **누적 총액**이다.
 *
 * @returns 취소된 예매. 짝이 맞지 않거나 이미 취소된 예매면 `null`.
 */
export async function finalizeTicketRefund(input: {
  orderId: string
  reservationId: string
  canceledAmount: number
  raw: unknown
}): Promise<Record<string, unknown> | null> {
  return db.transaction(async tx => {
    // 좌석부터 바꾼다. 짝이 맞지 않으면 원장을 건드리기 전에 빠져나온다.
    const [canceled] = await tx
      .update(reservations)
      .set({ status: 'canceled', canceledAt: new Date() })
      .where(
        and(
          eq(reservations.id, input.reservationId),
          eq(reservations.orderId, input.orderId),
          inArray(reservations.status, ['pending', 'confirmed'])
        )
      )
      .returning()
    if (!canceled) return null

    // 이미 기록된 금액보다 작은 통지는 낡은 것이므로 무시한다
    // (`recordPaymentCancel`과 같은 규칙 — 웹훅은 순서를 보장하지 않는다).
    await tx
      .update(payments)
      .set({
        canceledAmount: input.canceledAmount,
        status: sql`CASE WHEN ${input.canceledAmount} >= ${payments.amount} THEN 'canceled' ELSE 'partial_canceled' END`,
        rawResponse: input.raw,
      })
      .where(
        and(eq(payments.orderId, input.orderId), lt(payments.canceledAmount, input.canceledAmount))
      )

    return rowToReservation(canceled as unknown as Record<string, unknown>)
  })
}

/**
 * 취소. 자리는 즉시 재고로 돌아간다.
 *
 * `expectedOrderId`를 주면 그 주문의 예매만 취소한다. 승인 실패 경로에서
 * 반드시 줘야 한다 — 예전에는 요청 본문의 예매 id를 그대로 취소해, 결제를 한
 * 푼도 하지 않고 남의 대기 예매를 없앨 수 있었다.
 */
export async function cancelReservation(
  id: string,
  options: { expectedOrderId?: string } = {}
): Promise<Record<string, unknown> | null> {
  const conditions = [
    eq(reservations.id, id),
    inArray(reservations.status, ['pending', 'confirmed']),
  ]
  if (options.expectedOrderId) {
    conditions.push(eq(reservations.orderId, options.expectedOrderId))
  }
  await db
    .update(reservations)
    .set({ status: 'canceled', canceledAt: new Date() })
    .where(and(...conditions))
  return getReservationById(id)
}

/**
 * 만료된 선점을 정리한다.
 *
 * 재고 계산은 이미 만료를 감안하므로 이 작업이 없어도 자리는 팔린다. 다만
 * 상태가 `pending`으로 남아 있으면 관리자 화면에서 "결제 대기"가 끝없이
 * 쌓여 보이므로 주기적으로 정리한다.
 *
 * @returns 정리한 건수.
 */
export async function expireStaleHolds(now: Date = new Date()): Promise<number> {
  // 조회와 갱신을 나누면 그 사이에 확정된 건이 반환 건수에서 어긋난다. 한 문장의
  // RETURNING이 실제로 바꾼 행만 세므로 보고 값과 결과가 항상 일치한다.
  const expired = await db
    .update(reservations)
    .set({ status: 'expired' })
    .where(and(eq(reservations.status, 'pending'), lte(reservations.holdExpiresAt, now)))
    .returning({ id: reservations.id })
  return expired.length
}

export async function getReservationById(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1)
  return rows[0] ? rowToReservation(rows[0]) : null
}

export async function getReservationByCode(code: string): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(reservations)
    .where(eq(reservations.reservationCode, code))
    .limit(1)
  return rows[0] ? rowToReservation(rows[0]) : null
}

export async function listReservationsByShow(showId: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(reservations)
    .where(eq(reservations.showId, showId))
    .orderBy(desc(reservations.createdAt))
  return rows.map(rowToReservation)
}

/** 한 회원의 예매 내역. 마이페이지에 쓴다. */
export async function listReservationsByUser(userId: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select({
      reservation: reservations,
      show: performanceShows,
      performance: performances,
      ticketType: ticketTypes,
    })
    .from(reservations)
    .innerJoin(performanceShows, eq(performanceShows.id, reservations.showId))
    .innerJoin(performances, eq(performances.id, performanceShows.performanceId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, reservations.ticketTypeId))
    .where(
      and(eq(reservations.userId, userId), inArray(reservations.status, ['confirmed', 'canceled']))
    )
    .orderBy(desc(reservations.createdAt))

  return rows.map(row => ({
    ...rowToReservation(row.reservation as unknown as Record<string, unknown>),
    performance_title: row.performance.title,
    performance_slug: row.performance.slug,
    venue: row.performance.venue,
    starts_at: toIso(row.show.startsAt as Date | null),
    ticket_type_name: row.ticketType.name,
  }))
}

// ------------------------------------------------------------------ 공연 조회

/** 예매를 받는 공연 목록. 회차가 하나도 남지 않은 공연은 뺀다. */
export async function listOpenPerformances(
  now: Date = new Date()
): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(performances)
    .where(eq(performances.status, 'open'))
    .orderBy(asc(performances.createdAt))

  if (rows.length === 0) return []

  // 공연마다 회차를 따로 읽으면 공연 수만큼 원격 왕복이 든다. 한 번에 받아
  // 메모리에서 나눈다 — 예매 목록은 공개 페이지라 왕복 하나가 그대로 체감된다.
  const upcomingShows = await db
    .select()
    .from(performanceShows)
    .where(
      and(
        inArray(
          performanceShows.performanceId,
          rows.map(performance => performance.id)
        ),
        gt(performanceShows.startsAt, now)
      )
    )
    .orderBy(asc(performanceShows.startsAt))

  const showsByPerformance = new Map<string, typeof upcomingShows>()
  for (const show of upcomingShows) {
    const bucket = showsByPerformance.get(show.performanceId)
    if (bucket) bucket.push(show)
    else showsByPerformance.set(show.performanceId, [show])
  }

  const result: Record<string, unknown>[] = []
  for (const performance of rows) {
    const shows = showsByPerformance.get(performance.id)
    if (!shows || shows.length === 0) continue
    result.push({
      ...toSnakeCase(performance as unknown as Record<string, unknown>),
      created_at: toIso(performance.createdAt as Date | null),
      updated_at: toIso(performance.updatedAt as Date | null),
      next_show_at: toIso(shows[0].startsAt as Date | null),
      show_count: shows.length,
    })
  }
  return result
}

/** 공연 상세 — 회차·티켓 종류·남은 좌석까지 한 번에. */
export async function getPerformanceDetail(
  slug: string,
  now: Date = new Date()
): Promise<Record<string, unknown> | null> {
  const [performance] = await db
    .select()
    .from(performances)
    .where(eq(performances.slug, slug))
    .limit(1)
  if (!performance) return null

  // 회차와 티켓 종류는 서로를 필요로 하지 않는다. 직렬로 기다릴 이유가 없다.
  const [shows, types] = await Promise.all([
    db
      .select()
      .from(performanceShows)
      .where(eq(performanceShows.performanceId, performance.id))
      .orderBy(asc(performanceShows.startsAt)),
    db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.performanceId, performance.id))
      .orderBy(asc(ticketTypes.sortOrder)),
  ])

  const remainingByShow = await getRemainingSeatsByShow(
    new Map(shows.map(show => [show.id, Number(show.capacity)])),
    now
  )
  const showsWithSeats = shows.map(show => ({
    ...rowToShow(show as unknown as Record<string, unknown>),
    remaining_seats: remainingByShow.get(show.id) ?? 0,
    is_past: (show.startsAt as Date).getTime() <= now.getTime(),
  }))

  return {
    ...toSnakeCase(performance as unknown as Record<string, unknown>),
    created_at: toIso(performance.createdAt as Date | null),
    updated_at: toIso(performance.updatedAt as Date | null),
    shows: showsWithSeats,
    ticket_types: types.map(type => toSnakeCase(type as unknown as Record<string, unknown>)),
  }
}

/** 예매 화면이 금액을 계산할 때 쓰는 단건 조회. */
export async function getTicketType(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(ticketTypes).where(eq(ticketTypes.id, id)).limit(1)
  return rows[0] ? toSnakeCase(rows[0] as unknown as Record<string, unknown>) : null
}

export async function getShow(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(performanceShows).where(eq(performanceShows.id, id)).limit(1)
  return rows[0] ? rowToShow(rows[0] as unknown as Record<string, unknown>) : null
}
