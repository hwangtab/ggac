// src/db/schema/timebank.ts
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import {
  TIMEBANK_CATEGORIES,
  TIMEBANK_KINDS,
  TIMEBANK_LISTING_KINDS,
  TIMEBANK_LISTING_STATUSES,
  TIMEBANK_REF_TYPES,
  TIMEBANK_STATUSES,
  type TimebankCategory,
} from '../../constants/timebank.ts'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

/**
 * 조합원 타임뱅크 (2026-11-02, 스펙 `docs/superpowers/specs/2026-11-02-member-timebank-design.md` §3).
 *
 * 장터(`market.ts`)와 같은 이유로 `posts`에 얹지 않고 표를 따로 둔다 — 이 표들을
 * 읽는 코드는 `/api/timebank/*`·관리자·이사회 라우트뿐이라 아무것도 하지 않은
 * 상태가 곧 비공개다.
 *
 * 허용값은 `src/constants/timebank.ts`가 정본이다. DB CHECK는 `minutes > 0`
 * 하나뿐이다(상수와 무관한 불변식).
 *
 * **원장 불변성은 마이그레이션의 트리거 세 개가 지킨다**(`0025_timebank.sql`).
 * `drizzle-kit push`는 트리거를 모르므로 `db:push:local`로 만든 DB(E2E 포함)에는
 * 트리거가 없다 — 불변성은 `scripts/testing/timebankSchema.test.mjs`가 마이그레이션
 * 적용 DB로 증명한다.
 */

/** 참여자 프로필·이용규칙 동의. 탈퇴 트랜잭션이 직접 DELETE한다(묘비 회원은 cascade가 안 돈다). */
export const timebankProfiles = sqliteTable('timebank_profiles', {
  memberId: text('member_id')
    .primaryKey()
    .references(() => memberProfiles.id, { onDelete: 'cascade' }),
  /** 평문. */
  offers: text('offers').notNull().default(''),
  needs: text('needs').notNull().default(''),
  categories: text('categories', { mode: 'json' })
    .$type<TimebankCategory[]>()
    .notNull()
    .default(sql`'[]'`),
  /** 재능 디렉터리 노출. */
  visible: integer('visible', { mode: 'boolean' }).notNull().default(false),
  /** 동의한 이용규칙 판. 현재 판과 같아야 쓰기 가능(스펙 §9.4). */
  termsVersion: text('terms_version'),
  agreedAt: integer('agreed_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** 게시판 글. `coop_task`는 관리자 라우트로만 만든다. */
export const timebankListings = sqliteTable(
  'timebank_listings',
  {
    id: uuidPk(),
    authorId: text('author_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: TIMEBANK_LISTING_KINDS }).notNull(),
    category: text('category', { enum: TIMEBANK_CATEGORIES }).notNull(),
    title: text('title').notNull(),
    /** 평문. */
    description: text('description').notNull(),
    /** 30분 배수 또는 미정(null). */
    estimatedMinutes: integer('estimated_minutes'),
    status: text('status', { enum: TIMEBANK_LISTING_STATUSES }).notNull().default('open'),
    /** 'YYYY-MM-DD'(타임존 해석을 피한다 — `daily_activity_stats.activity_date`와 같다). */
    taskDate: text('task_date'),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('timebank_listings_list_idx').on(
      table.isDeleted,
      table.kind,
      table.status,
      sql`\`created_at\` DESC`
    ),
    index('timebank_listings_author_idx').on(table.authorId, sql`\`created_at\` DESC`),
  ]
)

/** 글의 댓글. 장터 댓글과 같은 모양(`market.ts`). */
export const timebankComments = sqliteTable(
  'timebank_comments',
  {
    id: uuidPk(),
    listingId: text('listing_id')
      .notNull()
      .references(() => timebankListings.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [index('timebank_comments_listing_idx').on(table.listingId, table.createdAt)]
)

/** 조합 업무 자원 기록. 조합 업무 지급은 이 행이 있는 사람에게만 한다(스펙 §6). */
export const timebankTaskVolunteers = sqliteTable(
  'timebank_task_volunteers',
  {
    id: uuidPk(),
    listingId: text('listing_id')
      .notNull()
      .references(() => timebankListings.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    volunteeredAt: integer('volunteered_at', { mode: 'timestamp_ms' }).notNull(),
    /** 철회 시각. 재자원하면 null로 돌아온다. */
    withdrawnAt: integer('withdrawn_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [uniqueIndex('timebank_task_volunteers_pair_uq').on(table.listingId, table.memberId)]
)

/**
 * 원장. 한 행이 한 번의 이동이고 잔액은 저장하지 않는다:
 * `잔액 = Σ(to = 나) − Σ(from = 나)`, `status = 'confirmed'`만.
 *
 * `from_account`·`to_account`는 회원 id 또는 `'coop'`(`COOP_ACCOUNT`)이라 FK가 없다.
 * 상태 전이는 전부 `UPDATE … WHERE id = ? AND status = 'pending'` 조건부로만 한다.
 *
 * 부분 인덱스 조건은 raw SQL·비한정 컬럼명으로 쓴다 — `${table.col}`은 표 이름이
 * 붙어 렌더되고 SQLite가 부분 인덱스 WHERE에서 그것을 거부한다(`content.ts`의
 * `post_attachments_primary_idx`, `billing.ts` 선례).
 */
export const timebankTransfers = sqliteTable(
  'timebank_transfers',
  {
    id: uuidPk(),
    fromAccount: text('from_account').notNull(),
    toAccount: text('to_account').notNull(),
    minutes: integer('minutes').notNull(),
    kind: text('kind', { enum: TIMEBANK_KINDS }).notNull(),
    status: text('status', { enum: TIMEBANK_STATUSES }).notNull(),
    /** 기록한 사람. 시스템 지급(동의 시 가입 크레딧 등)은 null. */
    createdBy: text('created_by'),
    /** 확인해야 하는 사람. pending일 때만 의미가 있다. */
    counterpartyId: text('counterparty_id'),
    /** 확인·거절·취소한 사람과 때. 월 상한은 `decided_at` 기준이다. */
    decidedBy: text('decided_by'),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    refType: text('ref_type', { enum: TIMEBANK_REF_TYPES }),
    refId: text('ref_id'),
    /** 되돌리는 원 이동(`reversal`·`redeem_refund`). */
    reversesId: text('reverses_id'),
    category: text('category', { enum: TIMEBANK_CATEGORIES }),
    /** 조정·정산·되돌림은 필수(라우트가 강제한다). */
    memo: text('memo'),
    /** 기록 시점 표시명. 탈퇴 시 묘비 이름(`WITHDRAWN_DISPLAY_NAME`)으로만 덮을 수 있다. */
    fromName: text('from_name'),
    toName: text('to_name'),
    /** 큰 조정의 두 번째 관리자(스펙 §7.3). */
    approvedBy: text('approved_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('timebank_transfers_from_idx').on(table.fromAccount, table.status),
    index('timebank_transfers_to_idx').on(table.toAccount, table.status),
    index('timebank_transfers_status_created_idx').on(table.status, table.createdAt),
    index('timebank_transfers_counterparty_idx').on(table.counterpartyId, table.status),
    /** 가입 크레딧은 회원당 한 번. */
    uniqueIndex('timebank_transfers_signup_grant_uq')
      .on(table.toAccount)
      .where(sql`"kind" = 'signup_grant'`),
    /** 살아 있는 되돌림은 원 이동당 하나. 거절·취소된 되돌림은 자리를 차지하지 않는다. */
    uniqueIndex('timebank_transfers_reversal_uq')
      .on(table.reversesId)
      .where(sql`"reverses_id" IS NOT NULL AND "status" IN ('pending', 'confirmed')`),
    /** 장터 한 글 한 거래. 되돌림은 kind가 `reversal`이라 걸리지 않는다. */
    uniqueIndex('timebank_transfers_market_uq')
      .on(table.refId)
      .where(sql`"kind" = 'market' AND "status" IN ('pending', 'confirmed')`),
    /** 재가입 승계는 회원당 한 번. */
    uniqueIndex('timebank_transfers_carryover_uq')
      .on(table.fromAccount)
      .where(sql`"kind" = 'carryover'`),
    /** 조합 업무 중복 지급 방지. */
    uniqueIndex('timebank_transfers_coop_task_uq')
      .on(table.refId, table.toAccount)
      .where(sql`"kind" = 'coop_task' AND "status" = 'confirmed'`),
    check('timebank_transfers_minutes_positive', sql`"minutes" > 0`),
  ]
)

/**
 * 재가입 승계 키. `key_hash` = HMAC-SHA256(`BETTER_AUTH_SECRET` 파생 키, 정규화한
 * 이메일 또는 전화). 원문은 남기지 않는다. 같은 키가 다시 오면 `ON CONFLICT DO UPDATE`.
 */
export const timebankWithdrawnKeys = sqliteTable('timebank_withdrawn_keys', {
  keyHash: text('key_hash').primaryKey(),
  balanceMinutes: integer('balance_minutes').notNull(),
  withdrawnAt: integer('withdrawn_at', { mode: 'timestamp_ms' }).notNull(),
})
