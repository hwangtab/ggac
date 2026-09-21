// src/db/schema/funding.ts
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'
import { payments } from './payments.ts'

/**
 * 조합원 프로젝트 펀딩.
 *
 * 티켓 예매와 같은 뼈대다 — 재고(한정 리워드)를 먼저 잡고, 결제가 확정되면
 * `paid`가 된다. 다른 점은 캠페인이 **심사**를 거쳐 공개되고, 마감은 시간이
 * 아니라 사람이 누른다는 것이다(`end_at`은 표시 전용).
 */

export const CAMPAIGN_STATUS = ['draft', 'submitted', 'active', 'closed', 'settled'] as const
export const PLEDGE_STATUS = ['pending', 'paid', 'canceled', 'refunded', 'expired'] as const
export const FULFILLMENT_STATUS = ['none', 'preparing', 'shipped', 'delivered'] as const
export const ENTRY_SOURCE = ['online', 'manual'] as const
export const SETTLEMENT_STATUS = ['pending', 'paid'] as const
export const FUNDING_CATEGORY = ['공연', '음반', '전시', '출판', '영상', '기타'] as const

export const fundingCampaigns = sqliteTable(
  'funding_campaigns',
  {
    id: uuidPk(),
    /** `/funding/{slug}`. 승인 후 불변. */
    slug: text('slug').notNull().unique(),
    ownerUserId: text('owner_user_id').references(() => memberProfiles.id, {
      onDelete: 'set null',
    }),
    /** `data/projects.json`의 slug. FK 없음 — 정적 파일이라 걸 수 없다. */
    projectSlug: text('project_slug'),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    /** 마크다운. 화면에서 sanitize-html을 거친다. */
    story: text('story').notNull().default(''),
    coverImage: text('cover_image'),
    ogImage: text('og_image'),
    category: text('category', { enum: FUNDING_CATEGORY }).notNull().default('기타'),
    goalAmount: integer('goal_amount').notNull(),
    /** 표시 전용. 접수 개폐는 `status`만 본다. */
    startAt: integer('start_at', { mode: 'timestamp_ms' }),
    endAt: integer('end_at', { mode: 'timestamp_ms' }),
    status: text('status', { enum: CAMPAIGN_STATUS }).notNull().default('draft'),
    reviewNote: text('review_note'),
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
    settledAt: integer('settled_at', { mode: 'timestamp_ms' }),
    /** 만분율(bp). 승인 시점의 설정값 스냅샷. */
    platformFeeRate: integer('platform_fee_rate').notNull().default(0),
    termsVersion: text('terms_version'),
    termsAgreedAt: integer('terms_agreed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('funding_campaigns_status_idx').on(table.status),
    index('funding_campaigns_owner_idx').on(table.ownerUserId),
  ]
)

export const fundingRewards = sqliteTable(
  'funding_rewards',
  {
    id: uuidPk(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => fundingCampaigns.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    /** 원 단위 정수, 0 초과. */
    amount: integer('amount').notNull(),
    /** null이면 무제한. */
    totalQuantity: integer('total_quantity'),
    requiresShipping: integer('requires_shipping', { mode: 'boolean' }).notNull().default(false),
    /** 'YYYY-MM'. */
    estimatedDelivery: text('estimated_delivery'),
    imageUrl: text('image_url'),
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * 결제된 후원이 처음 붙은 시각. 값이 있으면 금액·배송 여부·삭제가 막힌다
     * (수량은 늘리기만 된다). 가격을 바꾸려면 새 리워드를 만든다.
     */
    lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [index('funding_rewards_campaign_idx').on(table.campaignId, table.sortOrder)]
)

export const fundingPledges = sqliteTable(
  'funding_pledges',
  {
    id: uuidPk(),
    /** 후원자에게 보이는 번호. `FND-YYYYMMDD-XXXXXXXX`. */
    pledgeCode: text('pledge_code').notNull().unique(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => fundingCampaigns.id, { onDelete: 'restrict' }),
    rewardId: text('reward_id')
      .notNull()
      .references(() => fundingRewards.id, { onDelete: 'restrict' }),
    /** 비회원 후원을 허용하므로 선택. */
    userId: text('user_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** 선점과 같은 INSERT에 새기는 결제 주문번호. 승인·취소가 이 값으로 짝을 본다. */
    orderId: text('order_id').notNull(),
    paymentId: text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    backerName: text('backer_name').notNull(),
    backerEmail: text('backer_email').notNull(),
    backerPhone: text('backer_phone'),
    /** 후원 시점 스냅샷. 리워드가 나중에 바뀌어도 이 값은 그대로다. */
    rewardTitle: text('reward_title').notNull(),
    unitAmount: integer('unit_amount').notNull(),
    quantity: integer('quantity').notNull(),
    additionalAmount: integer('additional_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    status: text('status', { enum: PLEDGE_STATUS }).notNull().default('pending'),
    holdExpiresAt: integer('hold_expires_at', { mode: 'timestamp_ms' }),
    paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
    canceledAt: integer('canceled_at', { mode: 'timestamp_ms' }),
    refundedAt: integer('refunded_at', { mode: 'timestamp_ms' }),
    isAnonymous: integer('is_anonymous', { mode: 'boolean' }).notNull().default(false),
    supporterMessage: text('supporter_message'),
    messagePublic: integer('message_public', { mode: 'boolean' }).notNull().default(false),
    shippingName: text('shipping_name'),
    shippingPhone: text('shipping_phone'),
    shippingPostcode: text('shipping_postcode'),
    shippingAddress1: text('shipping_address1'),
    shippingAddress2: text('shipping_address2'),
    shippingMemo: text('shipping_memo'),
    fulfillmentStatus: text('fulfillment_status', { enum: FULFILLMENT_STATUS })
      .notNull()
      .default('none'),
    entrySource: text('entry_source', { enum: ENTRY_SOURCE }).notNull().default('online'),
    termsVersion: text('terms_version'),
    termsAgreedAt: integer('terms_agreed_at', { mode: 'timestamp_ms' }),
    privacyAgreedAt: integer('privacy_agreed_at', { mode: 'timestamp_ms' }),
    adminMemo: text('admin_memo'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('funding_pledges_campaign_status_idx').on(table.campaignId, table.status),
    index('funding_pledges_user_idx').on(table.userId),
    index('funding_pledges_hold_idx').on(table.status, table.holdExpiresAt),
    index('funding_pledges_reward_idx').on(table.rewardId, table.status),
    /** 한 주문이 두 후원을 확정하면 초과 판매다. */
    uniqueIndex('funding_pledges_order_id_idx').on(table.orderId),
  ]
)

export const fundingSettlements = sqliteTable('funding_settlements', {
  id: uuidPk(),
  campaignId: text('campaign_id')
    .notNull()
    .unique()
    .references(() => fundingCampaigns.id, { onDelete: 'restrict' }),
  grossAmount: integer('gross_amount').notNull().default(0),
  refundAmount: integer('refund_amount').notNull().default(0),
  pgFeeAmount: integer('pg_fee_amount').notNull().default(0),
  platformFeeAmount: integer('platform_fee_amount').notNull().default(0),
  payoutAmount: integer('payout_amount').notNull().default(0),
  backerCount: integer('backer_count').notNull().default(0),
  status: text('status', { enum: SETTLEMENT_STATUS }).notNull().default('pending'),
  paidOutAt: integer('paid_out_at', { mode: 'timestamp_ms' }),
  memo: text('memo'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})
