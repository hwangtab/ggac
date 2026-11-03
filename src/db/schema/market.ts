// src/db/schema/market.ts
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import {
  MARKET_AUCTION_STATES,
  MARKET_CONDITIONS,
  MARKET_DEAL_TYPES,
  MARKET_ITEM_CATEGORIES,
  MARKET_STATUSES,
  MARKET_TRADE_METHODS,
} from '../../constants/market.ts'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

/**
 * 조합원 장터 (2026-10-29).
 *
 * **`posts`에 카테고리로 얹지 않은 이유**: 게시판은 비회원도 읽고, 상세
 * `/board/[id]`는 ISR(60초)이라 렌더된 HTML이 공용 캐시에 남는다. 장터 글을
 * `posts`에 넣으면 그 캐시와 공개 API(`/api/posts/*`·`/api/board/*`·사이트맵·
 * `llms.txt`) 열 곳 남짓을 하나하나 막아야 하고, 하나라도 빠뜨리면 조용히
 * 새어 나간다. 표를 따로 두면 **아무것도 하지 않은 상태가 곧 비공개**다 —
 * 이 표를 읽는 코드는 `/api/market/*`와 `/board/market/*`뿐이고, 둘 다
 * 승인 조합원만 들인다.
 *
 * 허용값은 `src/constants/market.ts`가 정본이다(DB CHECK 없음, 펀딩과 같다).
 */
export const marketListings = sqliteTable(
  'market_listings',
  {
    id: uuidPk(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** 평문. 화면은 줄바꿈만 살려 텍스트로 그린다(HTML을 받지 않는다). */
    description: text('description').notNull(),
    dealType: text('deal_type', { enum: MARKET_DEAL_TYPES }).notNull(),
    itemCategory: text('item_category', { enum: MARKET_ITEM_CATEGORIES }).notNull(),
    /** 원 단위. 나눔은 0, '삽니다'는 미정(null)일 수 있다. */
    price: integer('price'),
    status: text('status', { enum: MARKET_STATUSES }).notNull().default('open'),
    condition: text('item_condition', { enum: MARKET_CONDITIONS }),
    tradeMethod: text('trade_method', { enum: MARKET_TRADE_METHODS }),
    region: text('region'),
    /**
     * 사진 URL 배열(JSON). `/api/media/upload`가 돌려준 공개 Blob 주소이고,
     * 쓰기 라우트가 **올린 사람이 판매자 본인인지** 업로드 원장으로 확인한다.
     * 업로드 정리 크론(`listCleanupCandidates`)이 이 칸을 참조로 센다 — 빠지면
     * 사진이 7일 뒤 지워진다.
     */
    images: text('images', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
    statusChangedAt: integer('status_changed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('market_listings_list_idx').on(table.isDeleted, table.status, sql`\`created_at\` DESC`),
    index('market_listings_seller_idx').on(table.sellerId, sql`\`created_at\` DESC`),
  ]
)

/** 장터 글의 댓글. 거래 문의가 여기로 온다(쪽지 기능이 없다). */
export const marketComments = sqliteTable(
  'market_comments',
  {
    id: uuidPk(),
    listingId: text('listing_id')
      .notNull()
      .references(() => marketListings.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [index('market_comments_listing_idx').on(table.listingId, table.createdAt)]
)

/**
 * 경매 매물의 경매 칸. `market_listings`와 1:1이고 `deal_type = 'auction'`인
 * 매물에만 있다. 사진·댓글·권한·탈퇴 처리는 매물 쪽을 그대로 쓴다.
 *
 * `current_price`·`current_bidder_id`·`bid_count`는 `market_bids`에서 계산할 수
 * 있는 값을 **일부러 복제해 둔 것**이다. 입찰은 "지금 최고가보다 호가 단위
 * 이상 높은가"를 조건으로 건 UPDATE 한 문장으로 받는다(`placeBid`) — 그 조건이
 * 한 행 안에 있어야 동시에 들어온 두 입찰이 둘 다 이기지 못한다. 입찰 무효
 * 처리 뒤에는 `recomputeAuction`이 `market_bids`에서 다시 맞춘다.
 *
 * 시각은 전부 서버 시각이다. `ends_at`은 막판 입찰로 늘어날 수 있고, 처음
 * 정한 값은 `original_ends_at`에 남는다.
 */
export const marketAuctions = sqliteTable(
  'market_auctions',
  {
    listingId: text('listing_id')
      .primaryKey()
      .references(() => marketListings.id, { onDelete: 'cascade' }),
    startPrice: integer('start_price').notNull(),
    minIncrement: integer('min_increment').notNull(),
    currentPrice: integer('current_price'),
    currentBidderId: text('current_bidder_id').references(() => memberProfiles.id, {
      onDelete: 'set null',
    }),
    bidCount: integer('bid_count').notNull().default(0),
    endsAt: integer('ends_at', { mode: 'timestamp_ms' }).notNull(),
    originalEndsAt: integer('original_ends_at', { mode: 'timestamp_ms' }).notNull(),
    state: text('state', { enum: MARKET_AUCTION_STATES }).notNull().default('live'),
    winnerId: text('winner_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    winningPrice: integer('winning_price'),
    closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [index('market_auctions_state_ends_idx').on(table.state, table.endsAt)]
)

/**
 * 입찰 기록. 입찰자는 취소하지 못한다 — 관리자만 `voided_at`으로 무효 처리한다
 * (오타 입찰·장난 입찰). 행은 지우지 않는다: 누가 언제 얼마를 불렀는지가 낙찰의
 * 근거다.
 */
export const marketBids = sqliteTable(
  'market_bids',
  {
    id: uuidPk(),
    listingId: text('listing_id')
      .notNull()
      .references(() => marketListings.id, { onDelete: 'cascade' }),
    bidderId: text('bidder_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    voidedBy: text('voided_by'),
    createdAt: createdAt(),
  },
  table => [
    index('market_bids_listing_idx').on(table.listingId, sql`\`amount\` DESC`),
    index('market_bids_bidder_idx').on(table.bidderId),
  ]
)
