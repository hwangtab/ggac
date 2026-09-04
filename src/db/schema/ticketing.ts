import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'
import { payments } from './payments.ts'

/**
 * 공연 예매.
 *
 * 조합비와 결정적으로 다른 점은 **수량이 한정돼 있다**는 것이다. 조합비는
 * 누가 언제 내든 서로 간섭하지 않지만, 티켓은 마지막 한 장을 두 사람이
 * 동시에 살 수 있다. 그래서 이 모델의 중심은 가격이 아니라 **재고**다.
 *
 * 재고는 `performance_shows.capacity`에서 예매된 매수를 뺀 값이다. 예매는
 * 결제가 끝나기 전에 `pending`으로 자리를 먼저 잡고(선점), 결제가 확정되면
 * `confirmed`가 된다. 결제창을 열어 두고 사라진 사람의 자리는 만료 시각이
 * 지나면 자동으로 풀린다 — 그렇게 하지 않으면 팔지도 못한 채 좌석이 잠긴다.
 */

/** `draft` 준비 중(비공개) · `open` 예매 중 · `closed` 예매 마감 · `canceled` 공연 취소 */
export const PERFORMANCE_STATUS = ['draft', 'open', 'closed', 'canceled'] as const

/**
 * `pending` 결제 대기(자리 선점) · `confirmed` 예매 확정 ·
 * `canceled` 취소·환불 · `expired` 결제하지 않아 자리 반환
 */
export const RESERVATION_STATUS = ['pending', 'confirmed', 'canceled', 'expired'] as const

export const performances = sqliteTable(
  'performances',
  {
    id: uuidPk(),
    /** 주소에 쓰는 식별자. `/tickets/{slug}` */
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    /** 목록에 보이는 한 줄 소개. */
    summary: text('summary'),
    description: text('description'),
    venue: text('venue'),
    posterImage: text('poster_image'),
    status: text('status', { enum: PERFORMANCE_STATUS }).notNull().default('draft'),
    /** 공연별 안내(환불 규정 등). 없으면 사이트 공통 안내를 쓴다. */
    noticeText: text('notice_text'),
    createdBy: text('created_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [index('performances_status_idx').on(table.status)]
)

/**
 * 회차. 같은 공연을 여러 날 하면 회차마다 정원이 따로 있다.
 *
 * 좌석을 지정하지 않는 자유석이다 — 좌석도를 도입하면 좌석 단위 잠금이
 * 필요해지는데, 소규모 공연에서는 정원만으로 충분하다.
 */
export const performanceShows = sqliteTable(
  'performance_shows',
  {
    id: uuidPk(),
    performanceId: text('performance_id')
      .notNull()
      .references(() => performances.id, { onDelete: 'cascade' }),
    /** 공연 시작 시각. */
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    /** 이 회차에 팔 수 있는 총 매수. */
    capacity: integer('capacity').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [index('performance_shows_performance_idx').on(table.performanceId, table.startsAt)]
)

/** 티켓 종류와 가격. 일반·조합원·청소년처럼 같은 회차에 여러 가격이 있을 수 있다. */
export const ticketTypes = sqliteTable(
  'ticket_types',
  {
    id: uuidPk(),
    performanceId: text('performance_id')
      .notNull()
      .references(() => performances.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** 원 단위 정수. 0이면 무료 티켓이다. */
    price: integer('price').notNull(),
    /** 1인당 최대 구매 매수. */
    maxPerOrder: integer('max_per_order').notNull().default(4),
    /** 조합원만 살 수 있는 종류인가. */
    membersOnly: integer('members_only', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [index('ticket_types_performance_idx').on(table.performanceId, table.sortOrder)]
)

export const reservations = sqliteTable(
  'reservations',
  {
    id: uuidPk(),
    /** 사람이 읽고 부를 수 있는 예매번호. 현장에서 대조한다. */
    reservationCode: text('reservation_code').notNull().unique(),
    showId: text('show_id')
      .notNull()
      .references(() => performanceShows.id, { onDelete: 'restrict' }),
    ticketTypeId: text('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id, { onDelete: 'restrict' }),
    /**
     * 비회원도 예매할 수 있다 — 공연은 일반 관객이 대상이다. 그래서 회원
     * 연결은 선택이고, 예매자 정보는 아래 컬럼에 따로 새긴다.
     */
    userId: text('user_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /**
     * 이 예매를 위해 만든 결제 주문번호. **선점과 같은 순간에 새긴다.**
     *
     * 없으면 예매와 결제를 이어 주는 것이 아무것도 없다. `payment_id`는 승인이
     * 끝난 뒤에야 채워지므로, 승인을 판단하는 시점에는 쓸 수 없다. 그 틈으로
     * 싼 주문의 승인 결과를 비싼 예매에 붙이는 요청이 들어올 수 있었다.
     *
     * 비워 둘 수 있게 한 이유는 두 가지다 — 이 컬럼이 생기기 전의 예매가 이미
     * 있고, 결제가 필요 없는 무료 예매를 나중에 열 수 있다. 대신 값이 있으면
     * 유일하다(SQLite는 NULL을 서로 다른 값으로 보므로 빈 값은 제약 밖이다).
     */
    orderId: text('order_id'),
    bookerName: text('booker_name').notNull(),
    bookerPhone: text('booker_phone').notNull(),
    bookerEmail: text('booker_email'),
    quantity: integer('quantity').notNull(),
    /** 결제 시점의 단가 × 매수. 나중에 가격이 바뀌어도 이 값은 그대로다. */
    totalAmount: integer('total_amount').notNull(),
    status: text('status', { enum: RESERVATION_STATUS }).notNull().default('pending'),
    paymentId: text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    /**
     * 선점 만료 시각. 이 시각이 지난 `pending`은 재고 계산에서 빠진다.
     * 토스 결제 인증 유효시간(10분)에 맞춘다.
     */
    holdExpiresAt: integer('hold_expires_at', { mode: 'timestamp_ms' }),
    canceledAt: integer('canceled_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    /** 재고 계산이 회차별로 도므로 그 순서로 색인한다. */
    index('reservations_show_status_idx').on(table.showId, table.status),
    index('reservations_user_idx').on(table.userId),
    /**
     * 만료된 선점 정리가 `(status, hold_expires_at)`로 훑는다. 위의
     * `reservations_show_status_idx`는 선두가 `show_id`라 그 조회를 못 덮는다.
     */
    index('reservations_status_hold_idx').on(table.status, table.holdExpiresAt),
    /**
     * 승인 요청이 들고 온 주문번호로 예매를 되찾을 때 쓴다. 유일해야 하는
     * 이유는 성능이 아니라 정합성이다 — 한 주문이 두 예매를 확정하면 그 순간
     * 초과 판매다.
     *
     * 예매번호(`reservation_code`)에는 별도 인덱스를 두지 않는다. 컬럼 선언의
     * `.unique()`가 이미 유일 인덱스를 만들고 있어, 따로 선언하면 같은 인덱스를
     * 두 벌 유지하게 된다(0016이 실제로 그렇게 만들었고 0017이 지운다).
     */
    uniqueIndex('reservations_order_id_idx').on(table.orderId),
  ]
)
