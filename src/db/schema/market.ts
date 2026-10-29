// src/db/schema/market.ts
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import {
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
