import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

/**
 * 결제 원장과 월별 회비.
 *
 * 두 표를 나눈 이유: `payments`는 **결제 시도 한 건**의 기록이고,
 * `membership_dues`는 **어느 달 회비를 냈는가**의 기록이다. 한 달치 회비를
 * 실패 후 재시도하면 결제는 두 건, 회비는 한 건이다. 이걸 한 표에 합치면
 * 재시도 이력이 사라지거나 청구월이 중복된다.
 *
 * 회원을 지워도 원장은 남긴다(`set null`) — 세무 기록이라 지울 수 없다.
 * 대신 누가 냈는지 알 수 없게 되므로 `payer_name`·`payer_email`을 결제 시점에
 * 새겨 둔다.
 */

export const PAYMENT_KIND = ['dues', 'ticket'] as const

/**
 * `pending` 준비됨(결제창을 띄우기 직전) · `done` 승인 완료 ·
 * `failed` 실패 · `partial_canceled` 일부 환불 · `canceled` 전액 환불.
 */
export const PAYMENT_STATUS = ['pending', 'done', 'failed', 'partial_canceled', 'canceled'] as const

export const DUES_STATUS = ['unpaid', 'paid', 'canceled'] as const

export const payments = sqliteTable('payments', {
  id: uuidPk(),
  /**
   * 우리가 만들어 토스에 넘기는 주문번호. 토스 규격은 6~64자다.
   * 유일성이 없으면 승인 응답이 어느 행에 반영될지 알 수 없으므로 UNIQUE다.
   */
  orderId: text('order_id').notNull().unique(),
  userId: text('user_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
  kind: text('kind', { enum: PAYMENT_KIND }).notNull(),
  orderName: text('order_name').notNull(),
  /** 원 단위 정수. 실수로 두면 100원이 99.999999원이 되는 일이 실제로 생긴다. */
  amount: integer('amount').notNull(),
  status: text('status', { enum: PAYMENT_STATUS }).notNull().default('pending'),
  /** 토스가 발급하는 결제 식별자. 취소·조회에 쓴다. */
  paymentKey: text('payment_key'),
  method: text('method'),
  approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
  canceledAmount: integer('canceled_amount').notNull().default(0),
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
  /** 토스 응답 원문. 분쟁 시 우리 요약값이 아니라 이게 근거가 된다. */
  rawResponse: text('raw_response', { mode: 'json' }),
  /** 회원이 지워져도 남아야 하는 결제자 정보 스냅샷. */
  payerName: text('payer_name'),
  payerEmail: text('payer_email'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const membershipDues = sqliteTable(
  'membership_dues',
  {
    id: uuidPk(),
    userId: text('user_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** 'YYYY-MM'. KST 기준으로 계산해 넣는다. */
    billingMonth: text('billing_month').notNull(),
    amount: integer('amount').notNull(),
    status: text('status', { enum: DUES_STATUS }).notNull().default('unpaid'),
    paymentId: text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    /**
     * 회원당 청구월 하나.
     *
     * **이것만으로는 이중 청구를 막지 못한다.** 이 제약은 회비 *행*이 둘 생기는
     * 것을 막을 뿐, 카드가 두 번 긁히는 것과는 무관하다 — 청구가 성공한 뒤
     * 납부 표시 직전에 죽으면 행은 하나인 채 `unpaid`로 남고 다음 실행이 다시
     * 긁는다(2026-09-01 감사에서 실측·재현). 실제 방어선은 `billingRun.ts`가
     * 청구 **전에** 거는 선점(`claimDuesForCharge`)이고, 이 인덱스는 그 선점이
     * 걸릴 행이 하나임을 보장하는 역할이다.
     */
    uniqueIndex('membership_dues_user_month_idx').on(table.userId, table.billingMonth),
  ]
)
