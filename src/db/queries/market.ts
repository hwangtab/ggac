/**
 * 조합원 장터 쿼리 계층 (Turso/Drizzle).
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다.** 조합원 여부·
 * 판매자 본인 여부·관리자 여부는 전부 호출부(`src/app/api/market/*`,
 * `src/app/[locale]/board/market/*`)가 판정한다. 여기서는 검증된 값만 받는다.
 *
 * 응답 형태는 snake_case다(CLAUDE.md).
 *
 * 삭제는 `is_deleted` soft delete다. 목록·상세 조회는 삭제된 매물을 돌려주지
 * 않는다 — 호출부가 다시 거를 필요가 없게 여기서 끊는다.
 */

import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { marketComments, marketListings, memberProfiles } from '../schema/index.ts'
import type {
  MarketCondition,
  MarketDealType,
  MarketItemCategory,
  MarketStatus,
  MarketTradeMethod,
} from '../../constants/market.ts'

import { toIso } from './_helpers.ts'

export interface MarketListingRow {
  id: string
  seller_id: string
  seller_name: string
  title: string
  description: string
  deal_type: MarketDealType
  item_category: MarketItemCategory
  price: number | null
  status: MarketStatus
  condition: MarketCondition | null
  trade_method: MarketTradeMethod | null
  region: string | null
  images: string[]
  comment_count: number
  status_changed_at: string | null
  created_at: string
  updated_at: string
}

/** 목록 카드에 필요한 만큼. 본문 대신 사진 한 장만 싣는다. */
export type MarketListingSummary = Omit<MarketListingRow, 'description' | 'images'> & {
  thumbnail: string | null
}

const liveCommentCount = sql<number>`(
  SELECT count(*) FROM market_comments mc
  WHERE mc.listing_id = ${marketListings.id} AND mc.is_deleted = 0
)`

const listingColumns = {
  id: marketListings.id,
  sellerId: marketListings.sellerId,
  sellerName: memberProfiles.displayName,
  title: marketListings.title,
  description: marketListings.description,
  dealType: marketListings.dealType,
  itemCategory: marketListings.itemCategory,
  price: marketListings.price,
  status: marketListings.status,
  condition: marketListings.condition,
  tradeMethod: marketListings.tradeMethod,
  region: marketListings.region,
  images: marketListings.images,
  commentCount: liveCommentCount,
  statusChangedAt: marketListings.statusChangedAt,
  createdAt: marketListings.createdAt,
  updatedAt: marketListings.updatedAt,
}

type ListingSelectRow = {
  [K in keyof typeof listingColumns]: unknown
}

function toListingRow(row: ListingSelectRow): MarketListingRow {
  return {
    id: row.id as string,
    seller_id: row.sellerId as string,
    seller_name: row.sellerName as string,
    title: row.title as string,
    description: row.description as string,
    deal_type: row.dealType as MarketDealType,
    item_category: row.itemCategory as MarketItemCategory,
    price: (row.price as number | null) ?? null,
    status: row.status as MarketStatus,
    condition: (row.condition as MarketCondition | null) ?? null,
    trade_method: (row.tradeMethod as MarketTradeMethod | null) ?? null,
    region: (row.region as string | null) ?? null,
    images: Array.isArray(row.images) ? (row.images as string[]) : [],
    comment_count: Number(row.commentCount ?? 0),
    status_changed_at: toIso(row.statusChangedAt as Date | null),
    created_at: toIso(row.createdAt as Date) as string,
    updated_at: toIso(row.updatedAt as Date) as string,
  }
}

export interface ListMarketListingsFilter {
  status?: MarketStatus
  /** true면 거래완료를 뺀다. `status`가 주어지면 무시된다. */
  hideDone?: boolean
  dealType?: MarketDealType
  itemCategory?: MarketItemCategory
  sellerId?: string
  offset: number
  limit: number
}

/**
 * 최신순. 다음 페이지 유무를 알려고 `limit + 1`건을 읽는다.
 */
export async function listMarketListings(
  filter: ListMarketListingsFilter
): Promise<{ rows: MarketListingSummary[]; hasNext: boolean }> {
  const conditions = [eq(marketListings.isDeleted, false)]
  if (filter.status) conditions.push(eq(marketListings.status, filter.status))
  else if (filter.hideDone) conditions.push(ne(marketListings.status, 'done'))
  if (filter.dealType) conditions.push(eq(marketListings.dealType, filter.dealType))
  if (filter.itemCategory) conditions.push(eq(marketListings.itemCategory, filter.itemCategory))
  if (filter.sellerId) conditions.push(eq(marketListings.sellerId, filter.sellerId))

  const rows = await db
    .select(listingColumns)
    .from(marketListings)
    .innerJoin(memberProfiles, eq(memberProfiles.id, marketListings.sellerId))
    .where(and(...conditions))
    .orderBy(desc(marketListings.createdAt), desc(marketListings.id))
    .limit(filter.limit + 1)
    .offset(filter.offset)

  const hasNext = rows.length > filter.limit
  return {
    rows: rows.slice(0, filter.limit).map(row => {
      const { description: _description, images, ...rest } = toListingRow(row)
      return { ...rest, thumbnail: images[0] ?? null }
    }),
    hasNext,
  }
}

/** 삭제된 매물은 `null`이다. */
export async function getMarketListing(id: string): Promise<MarketListingRow | null> {
  const [row] = await db
    .select(listingColumns)
    .from(marketListings)
    .innerJoin(memberProfiles, eq(memberProfiles.id, marketListings.sellerId))
    .where(and(eq(marketListings.id, id), eq(marketListings.isDeleted, false)))
    .limit(1)
  return row ? toListingRow(row) : null
}

/** 소유권 판정용. 삭제된 매물은 `null`(이미 없는 것과 같게 404). */
export async function getMarketListingOwner(
  id: string
): Promise<{ seller_id: string; title: string; status: MarketStatus } | null> {
  const [row] = await db
    .select({
      sellerId: marketListings.sellerId,
      title: marketListings.title,
      status: marketListings.status,
    })
    .from(marketListings)
    .where(and(eq(marketListings.id, id), eq(marketListings.isDeleted, false)))
    .limit(1)
  return row ? { seller_id: row.sellerId, title: row.title, status: row.status } : null
}

export interface MarketListingFields {
  title: string
  description: string
  deal_type: MarketDealType
  item_category: MarketItemCategory
  price: number | null
  condition: MarketCondition | null
  trade_method: MarketTradeMethod | null
  region: string | null
  images: string[]
}

function fieldsToColumns(fields: Partial<MarketListingFields>) {
  const out: Partial<typeof marketListings.$inferInsert> = {}
  if (fields.title !== undefined) out.title = fields.title
  if (fields.description !== undefined) out.description = fields.description
  if (fields.deal_type !== undefined) out.dealType = fields.deal_type
  if (fields.item_category !== undefined) out.itemCategory = fields.item_category
  if (fields.price !== undefined) out.price = fields.price
  if (fields.condition !== undefined) out.condition = fields.condition
  if (fields.trade_method !== undefined) out.tradeMethod = fields.trade_method
  if (fields.region !== undefined) out.region = fields.region
  if (fields.images !== undefined) out.images = fields.images
  return out
}

export async function createMarketListing(
  sellerId: string,
  fields: MarketListingFields
): Promise<{ id: string }> {
  const [row] = await db
    .insert(marketListings)
    .values({
      sellerId,
      title: fields.title,
      description: fields.description,
      dealType: fields.deal_type,
      itemCategory: fields.item_category,
      price: fields.price,
      condition: fields.condition,
      tradeMethod: fields.trade_method,
      region: fields.region,
      images: fields.images,
    })
    .returning({ id: marketListings.id })
  return { id: row.id }
}

export async function updateMarketListing(
  id: string,
  fields: Partial<MarketListingFields>
): Promise<void> {
  const set = fieldsToColumns(fields)
  if (Object.keys(set).length === 0) return
  await db.update(marketListings).set(set).where(eq(marketListings.id, id))
}

export async function updateMarketListingStatus(id: string, status: MarketStatus): Promise<void> {
  await db
    .update(marketListings)
    .set({ status, statusChangedAt: new Date() })
    .where(eq(marketListings.id, id))
}

export async function softDeleteMarketListing(id: string): Promise<void> {
  await db.update(marketListings).set({ isDeleted: true }).where(eq(marketListings.id, id))
}

export interface MarketCommentRow {
  id: string
  listing_id: string
  author_id: string
  author_name: string
  /** 삭제된 댓글은 `null`. */
  content: string | null
  is_deleted: boolean
  created_at: string
}

/** 시간 오름차순(대화 순서). 삭제된 댓글은 자리만 남기고 본문을 싣지 않는다. */
export async function listMarketComments(listingId: string): Promise<MarketCommentRow[]> {
  const rows = await db
    .select({
      id: marketComments.id,
      listingId: marketComments.listingId,
      authorId: marketComments.authorId,
      authorName: memberProfiles.displayName,
      content: marketComments.content,
      isDeleted: marketComments.isDeleted,
      createdAt: marketComments.createdAt,
    })
    .from(marketComments)
    .innerJoin(memberProfiles, eq(memberProfiles.id, marketComments.authorId))
    .where(eq(marketComments.listingId, listingId))
    .orderBy(asc(marketComments.createdAt))

  return rows.map(row => ({
    id: row.id,
    listing_id: row.listingId,
    author_id: row.authorId,
    author_name: row.authorName,
    content: row.isDeleted ? null : row.content,
    is_deleted: row.isDeleted,
    created_at: toIso(row.createdAt) as string,
  }))
}

export async function createMarketComment(input: {
  listingId: string
  authorId: string
  content: string
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(marketComments)
    .values({ listingId: input.listingId, authorId: input.authorId, content: input.content })
    .returning({ id: marketComments.id })
  return { id: row.id }
}

/** 이 매물에 댓글을 남긴 사람들(삭제된 댓글 제외, 중복 없음). 알림 대상 산출용. */
export async function listMarketCommenterIds(listingId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ authorId: marketComments.authorId })
    .from(marketComments)
    .where(and(eq(marketComments.listingId, listingId), eq(marketComments.isDeleted, false)))
  return rows.map(row => row.authorId)
}

/**
 * 소유권·경로 대조용. `listing_id`를 함께 돌려주는 이유: 다른 매물 경로로
 * 남의 댓글을 지우려는 경로 위조를 라우트가 막을 수 있게 하기 위해서다.
 */
export async function getMarketCommentOwner(
  id: string
): Promise<{ author_id: string; listing_id: string; is_deleted: boolean } | null> {
  const [row] = await db
    .select({
      authorId: marketComments.authorId,
      listingId: marketComments.listingId,
      isDeleted: marketComments.isDeleted,
    })
    .from(marketComments)
    .where(eq(marketComments.id, id))
    .limit(1)
  return row
    ? { author_id: row.authorId, listing_id: row.listingId, is_deleted: row.isDeleted }
    : null
}

export async function softDeleteMarketComment(id: string): Promise<void> {
  await db.update(marketComments).set({ isDeleted: true }).where(eq(marketComments.id, id))
}

/** 회원별 살아 있는 매물 수. 도배 방지 상한에 쓴다. */
export async function countOpenListingsBySeller(sellerId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(marketListings)
    .where(
      and(
        eq(marketListings.sellerId, sellerId),
        eq(marketListings.isDeleted, false),
        inArray(marketListings.status, ['open', 'reserved'])
      )
    )
  return row?.total ?? 0
}
