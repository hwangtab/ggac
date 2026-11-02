/**
 * 조합원 장터 경매 쿼리 계층 (Turso/Drizzle).
 *
 * `market.ts`와 같은 규칙 — **권한을 모른다.** 누가 입찰·무효 처리·취소할
 * 자격이 있는지는 라우트가 판정한다. 다만 **경매 규칙**(마감 뒤 입찰 불가,
 * 판매자 셀프 입찰 불가, 최소 호가)은 여기서 지킨다. 그건 권한이 아니라 데이터의
 * 불변식이고, 라우트가 빠뜨려도 깨지면 안 된다.
 *
 * 시각은 호출부가 `now`로 넘긴다(테스트가 마감 경계를 고정할 수 있게). 운영
 * 호출부는 `new Date()`를 넘긴다 — 서버 시각만이 기준이다.
 */

import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { marketAuctions, marketBids, marketListings, memberProfiles } from '../schema/index.ts'
import {
  MARKET_AUCTION_EXTEND_MS,
  type MarketAuctionDuration,
  type MarketAuctionState,
} from '../../constants/market.ts'
import type { MarketListingFields } from './market.ts'

import { isLockContention, toIso } from './_helpers.ts'

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 쓰기 잠금 경합이면 짧게 다시 한다. 트랜잭션이 통째로 실패하면 아무것도 남지
 * 않으므로 재시도가 안전하다(`ticketing.ts`의 `holdReservation`과 같은 방식).
 * 입찰과 "보는 순간 닫기"·크론 닫기가 같은 행에 몰릴 수 있어 쓰기 전부에 건다.
 */
async function withContentionRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (!isLockContention(error)) throw error
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
  throw lastError
}

export interface AuctionRow {
  listing_id: string
  start_price: number
  min_increment: number
  current_price: number | null
  current_bidder_id: string | null
  current_bidder_name: string | null
  bid_count: number
  /** 다음 입찰이 넘어야 하는 최소 금액. */
  next_minimum: number
  ends_at: string
  original_ends_at: string
  state: MarketAuctionState
  winner_id: string | null
  winner_name: string | null
  winning_price: number | null
  closed_at: string | null
}

export function nextMinimum(row: {
  current_price: number | null
  start_price: number
  min_increment: number
}): number {
  return row.current_price === null ? row.start_price : row.current_price + row.min_increment
}

export interface AuctionInput {
  start_price: number
  min_increment: number
  duration_days: MarketAuctionDuration
}

/** 경매 매물을 만든다. 매물과 경매 칸은 한 트랜잭션이다 — 반쪽 경매가 남지 않는다. */
export async function createAuctionListing(
  sellerId: string,
  fields: MarketListingFields,
  auction: AuctionInput,
  now: Date
): Promise<{ id: string }> {
  return withContentionRetry(() =>
    db.transaction(async tx => {
      const [listing] = await tx
        .insert(marketListings)
        .values({
          sellerId,
          title: fields.title,
          description: fields.description,
          dealType: 'auction',
          itemCategory: fields.item_category,
          // 매물 표의 가격 칸에는 시작가를 둔다. 목록 정렬·표시는 경매 칸을 본다.
          price: auction.start_price,
          condition: fields.condition,
          tradeMethod: fields.trade_method,
          region: fields.region,
          images: fields.images,
        })
        .returning({ id: marketListings.id })

      const endsAt = new Date(now.getTime() + auction.duration_days * DAY_MS)
      await tx.insert(marketAuctions).values({
        listingId: listing.id,
        startPrice: auction.start_price,
        minIncrement: auction.min_increment,
        endsAt,
        originalEndsAt: endsAt,
      })
      return { id: listing.id }
    })
  )
}

/** 삭제된 매물의 경매는 `null`이다. */
export async function getAuction(listingId: string): Promise<AuctionRow | null> {
  const bidder = sql<
    string | null
  >`(SELECT display_name FROM member_profiles mp WHERE mp.id = ${marketAuctions.currentBidderId})`
  const winner = sql<
    string | null
  >`(SELECT display_name FROM member_profiles mp WHERE mp.id = ${marketAuctions.winnerId})`
  const [row] = await db
    .select({
      a: marketAuctions,
      bidderName: bidder,
      winnerName: winner,
    })
    .from(marketAuctions)
    .innerJoin(marketListings, eq(marketListings.id, marketAuctions.listingId))
    .where(and(eq(marketAuctions.listingId, listingId), eq(marketListings.isDeleted, false)))
    .limit(1)
  if (!row) return null
  const a = row.a
  const base = {
    current_price: a.currentPrice ?? null,
    start_price: a.startPrice,
    min_increment: a.minIncrement,
  }
  return {
    listing_id: a.listingId,
    ...base,
    current_bidder_id: a.currentBidderId ?? null,
    current_bidder_name: row.bidderName ?? null,
    bid_count: a.bidCount,
    next_minimum: nextMinimum(base),
    ends_at: toIso(a.endsAt) as string,
    original_ends_at: toIso(a.originalEndsAt) as string,
    state: a.state,
    winner_id: a.winnerId ?? null,
    winner_name: row.winnerName ?? null,
    winning_price: a.winningPrice ?? null,
    closed_at: toIso(a.closedAt),
  }
}

export interface BidRow {
  id: string
  bidder_id: string
  bidder_name: string
  amount: number
  voided: boolean
  created_at: string
}

/** 높은 금액순. 무효 처리된 입찰도 돌려준다(화면에 줄을 그어 보인다). */
export async function listBids(listingId: string): Promise<BidRow[]> {
  const rows = await db
    .select({
      id: marketBids.id,
      bidderId: marketBids.bidderId,
      bidderName: memberProfiles.displayName,
      amount: marketBids.amount,
      voidedAt: marketBids.voidedAt,
      createdAt: marketBids.createdAt,
    })
    .from(marketBids)
    .innerJoin(memberProfiles, eq(memberProfiles.id, marketBids.bidderId))
    .where(eq(marketBids.listingId, listingId))
    .orderBy(desc(marketBids.amount), asc(marketBids.createdAt))
  return rows.map(row => ({
    id: row.id,
    bidder_id: row.bidderId,
    bidder_name: row.bidderName,
    amount: row.amount,
    voided: row.voidedAt !== null,
    created_at: toIso(row.createdAt) as string,
  }))
}

/**
 * 입찰 결과. 판별 유니온으로 두지 않는다 — 이 저장소는 `strict: false`라 좁혀지지
 * 않는다(`ParseResult`와 같은 이유). `error`가 `null`일 때만 성공 칸이 채워진다.
 */
export interface PlaceBidResult {
  error: null | 'not_found' | 'not_live' | 'ended' | 'self_bid' | 'too_low'
  /** `too_low`일 때 넘어야 했던 금액. */
  minimum?: number
  bid_id?: string
  /** 이 입찰로 최고가를 빼앗긴 사람. 알림 대상이다(본인 재입찰이면 `null`). */
  outbid_bidder_id?: string | null
  ends_at?: string
  extended?: boolean
  /** 이 입찰 전에 살아 있는 최고가가 없었다(첫 입찰). 판매자 알림 기준이다. */
  first_bid?: boolean
}

/**
 * 입찰. **판정과 기록이 한 트랜잭션이고, 최종 판정은 조건부 UPDATE 한 문장이다.**
 *
 * 앞의 SELECT는 친절한 실패 이유를 고르는 데만 쓴다. 이기는지 지는지는 아래
 * UPDATE의 WHERE가 정한다 — "아직 진행 중 · 마감 전 · 현재가 + 호가 단위 이상 ·
 * 판매자 아님"을 한 행에 대해 원자적으로 본다. 동시에 들어온 같은 금액 두 건은
 * 먼저 쓴 쪽만 영향 행 1을 받고, 늦은 쪽은 0행이 되어 `too_low`로 돌아간다.
 *
 * 마감 `MARKET_AUCTION_EXTEND_MS` 안에 들어온 입찰은 마감을 그만큼 뒤로 민다.
 */
export async function placeBid(input: {
  listingId: string
  bidderId: string
  amount: number
  now: Date
}): Promise<PlaceBidResult> {
  return withContentionRetry(() => placeBidOnce(input))
}

async function placeBidOnce(input: {
  listingId: string
  bidderId: string
  amount: number
  now: Date
}): Promise<PlaceBidResult> {
  const nowMs = input.now.getTime()
  return db.transaction(async tx => {
    const [row] = await tx
      .select({
        state: marketAuctions.state,
        endsAt: marketAuctions.endsAt,
        currentPrice: marketAuctions.currentPrice,
        currentBidderId: marketAuctions.currentBidderId,
        startPrice: marketAuctions.startPrice,
        minIncrement: marketAuctions.minIncrement,
        sellerId: marketListings.sellerId,
      })
      .from(marketAuctions)
      .innerJoin(marketListings, eq(marketListings.id, marketAuctions.listingId))
      .where(
        and(eq(marketAuctions.listingId, input.listingId), eq(marketListings.isDeleted, false))
      )
      .limit(1)
    if (!row) return { error: 'not_found' as const }
    if (row.state !== 'live') return { error: 'not_live' as const }
    if (row.endsAt.getTime() <= nowMs) return { error: 'ended' as const }
    if (row.sellerId === input.bidderId) return { error: 'self_bid' as const }
    const minimum = nextMinimum({
      current_price: row.currentPrice ?? null,
      start_price: row.startPrice,
      min_increment: row.minIncrement,
    })
    if (input.amount < minimum) return { error: 'too_low' as const, minimum }

    const extendTo = nowMs + MARKET_AUCTION_EXTEND_MS
    const updated = await tx
      .update(marketAuctions)
      .set({
        currentPrice: input.amount,
        currentBidderId: input.bidderId,
        bidCount: sql`${marketAuctions.bidCount} + 1`,
        endsAt: sql`max(${marketAuctions.endsAt}, ${extendTo})`,
      })
      .where(
        and(
          eq(marketAuctions.listingId, input.listingId),
          eq(marketAuctions.state, 'live'),
          sql`${marketAuctions.endsAt} > ${nowMs}`,
          sql`${input.amount} >= coalesce(${marketAuctions.currentPrice} + ${marketAuctions.minIncrement}, ${marketAuctions.startPrice})`,
          sql`${input.bidderId} <> (SELECT seller_id FROM market_listings WHERE id = ${input.listingId})`
        )
      )
      .returning({ endsAt: marketAuctions.endsAt })
    if (updated.length !== 1) return { error: 'too_low' as const, minimum }

    const [bid] = await tx
      .insert(marketBids)
      .values({ listingId: input.listingId, bidderId: input.bidderId, amount: input.amount })
      .returning({ id: marketBids.id })

    const previous = row.currentBidderId ?? null
    return {
      error: null,
      bid_id: bid.id,
      outbid_bidder_id: previous && previous !== input.bidderId ? previous : null,
      ends_at: toIso(updated[0].endsAt) as string,
      extended: updated[0].endsAt.getTime() > row.endsAt.getTime(),
      first_bid: previous === null,
    }
  })
}

/**
 * 최고가·최고 입찰자·입찰 수를 `market_bids`(무효 제외)에서 다시 맞춘다.
 * 진행 중인 경매에만 한다 — 닫힌 경매의 낙찰은 기록이다.
 *
 * 한 문장이라 탈퇴 트랜잭션처럼 바깥 트랜잭션 안에서도 그대로 쓴다.
 */
export async function recomputeLiveAuctions(executor: Executor | typeof db, listingIds: string[]) {
  if (listingIds.length === 0) return
  const live = sql`market_bids.listing_id = market_auctions.listing_id AND market_bids.voided_at IS NULL`
  await executor
    .update(marketAuctions)
    .set({
      currentPrice: sql`(SELECT max(amount) FROM market_bids WHERE ${live})`,
      currentBidderId: sql`(SELECT bidder_id FROM market_bids WHERE ${live} ORDER BY amount DESC, created_at ASC LIMIT 1)`,
      bidCount: sql`(SELECT count(*) FROM market_bids WHERE ${live})`,
    })
    .where(and(inArray(marketAuctions.listingId, listingIds), eq(marketAuctions.state, 'live')))
}

export interface VoidBidResult {
  error: null | 'not_found' | 'already_voided' | 'closed'
  listing_id?: string
}

/** 관리자 입찰 무효 처리. 진행 중인 경매의 입찰만 — 닫힌 경매의 낙찰은 뒤집지 않는다. */
export async function voidBid(input: {
  bidId: string
  listingId: string
  actorId: string
  now: Date
}): Promise<VoidBidResult> {
  return withContentionRetry(() =>
    db.transaction(async tx => {
      const [bid] = await tx
        .select({ listingId: marketBids.listingId, voidedAt: marketBids.voidedAt })
        .from(marketBids)
        .where(eq(marketBids.id, input.bidId))
        .limit(1)
      // 다른 매물 경로로 이 입찰을 건드리는 요청은 "없는 입찰"과 같다.
      if (!bid || bid.listingId !== input.listingId) return { error: 'not_found' as const }
      if (bid.voidedAt) return { error: 'already_voided' as const }

      const [auction] = await tx
        .select({ state: marketAuctions.state, endsAt: marketAuctions.endsAt })
        .from(marketAuctions)
        .where(eq(marketAuctions.listingId, input.listingId))
        .limit(1)
      if (!auction || auction.state !== 'live' || auction.endsAt <= input.now) {
        return { error: 'closed' as const }
      }

      await tx
        .update(marketBids)
        .set({ voidedAt: input.now, voidedBy: input.actorId })
        .where(and(eq(marketBids.id, input.bidId), isNull(marketBids.voidedAt)))
      await recomputeLiveAuctions(tx, [input.listingId])
      return { error: null, listing_id: input.listingId }
    })
  )
}

export interface ClosedAuction {
  listing_id: string
  title: string
  seller_id: string
  state: 'ended' | 'no_bids'
  winner_id: string | null
  winning_price: number | null
}

/**
 * 마감이 지났으면 닫는다. **한 번만 닫힌다** — `state = 'live'` 조건의 UPDATE라
 * 동시에 여러 요청이 와도 영향 행을 받는 것은 하나뿐이고, 그 하나만 결과를
 * 돌려받는다(알림을 한 번만 보내게). 닫을 게 없으면 `null`.
 *
 * 낙찰이면 매물을 `reserved`(예약중)로 돌린다. 유찰이면 매물 상태는 그대로다.
 */
export async function closeAuctionIfDue(
  listingId: string,
  now: Date
): Promise<ClosedAuction | null> {
  // 쓰기 트랜잭션을 열기 전에 **읽기로 먼저 거른다.** 이 함수는 장터 상세를 열
  // 때마다(경매가 아닌 매물까지) 불린다. 곧장 트랜잭션을 열면 조회 한 번마다
  // 쓰기 잠금(BEGIN IMMEDIATE)을 잡아, 화면을 보는 것만으로 입찰과 잠금을 다툰다.
  // 닫을 게 있을 때만 아래로 내려가고, 거기서 조건부 UPDATE가 다시 판정한다.
  const [due] = await db
    .select({ listingId: marketAuctions.listingId })
    .from(marketAuctions)
    .where(
      and(
        eq(marketAuctions.listingId, listingId),
        eq(marketAuctions.state, 'live'),
        lte(marketAuctions.endsAt, now)
      )
    )
    .limit(1)
  if (!due) return null

  return withContentionRetry(() =>
    db.transaction(async tx => {
      const closed = await tx
        .update(marketAuctions)
        .set({
          state: sql`CASE WHEN ${marketAuctions.currentBidderId} IS NULL THEN 'no_bids' ELSE 'ended' END`,
          winnerId: sql`${marketAuctions.currentBidderId}`,
          winningPrice: sql`${marketAuctions.currentPrice}`,
          closedAt: now,
        })
        .where(
          and(
            eq(marketAuctions.listingId, listingId),
            eq(marketAuctions.state, 'live'),
            lte(marketAuctions.endsAt, now)
          )
        )
        .returning({
          state: marketAuctions.state,
          winnerId: marketAuctions.winnerId,
          winningPrice: marketAuctions.winningPrice,
        })
      if (closed.length !== 1) return null

      const [listing] = await tx
        .select({ title: marketListings.title, sellerId: marketListings.sellerId })
        .from(marketListings)
        .where(eq(marketListings.id, listingId))
        .limit(1)

      const state = closed[0].state as 'ended' | 'no_bids'
      if (state === 'ended') {
        await tx
          .update(marketListings)
          .set({ status: 'reserved', statusChangedAt: now })
          .where(eq(marketListings.id, listingId))
      }
      return {
        listing_id: listingId,
        title: listing?.title ?? '',
        seller_id: listing?.sellerId ?? '',
        state,
        winner_id: closed[0].winnerId ?? null,
        winning_price: closed[0].winningPrice ?? null,
      }
    })
  )
}

/** 마감이 지났는데 아직 열린 경매들. 크론·목록 화면이 쓴다. 오래된 것부터. */
export async function listDueAuctionIds(now: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ listingId: marketAuctions.listingId })
    .from(marketAuctions)
    .where(and(eq(marketAuctions.state, 'live'), lte(marketAuctions.endsAt, now)))
    .orderBy(asc(marketAuctions.endsAt))
    .limit(limit)
  return rows.map(row => row.listingId)
}

/**
 * 진행 중인 경매를 취소한다(입찰 없는 경매를 판매자가 내릴 때, 관리자가 내릴
 * 때). 닫힌 경매는 그대로 둔다. 영향을 받았으면 `true`.
 */
export async function cancelLiveAuction(
  listingId: string,
  now: Date,
  options: { onlyWithoutBids?: boolean } = {}
): Promise<boolean> {
  const result = await db
    .update(marketAuctions)
    .set({ state: 'canceled', closedAt: now })
    .where(
      and(
        eq(marketAuctions.listingId, listingId),
        eq(marketAuctions.state, 'live'),
        // 판매자 취소는 "입찰이 없을 때"만이다. 라우트가 앞에서 입찰 수를 봤어도
        // 그 사이 입찰이 들어올 수 있으므로, 같은 조건을 이 문장에 다시 건다.
        options.onlyWithoutBids ? eq(marketAuctions.bidCount, 0) : undefined
      )
    )
  return (result.rowsAffected ?? 0) > 0
}

/** 경매 상태만 가볍게 읽는다(취소 실패 이유를 가르는 데 쓴다). */
export async function getAuctionState(
  listingId: string
): Promise<{ state: MarketAuctionState; bid_count: number } | null> {
  const [row] = await db
    .select({ state: marketAuctions.state, bidCount: marketAuctions.bidCount })
    .from(marketAuctions)
    .where(eq(marketAuctions.listingId, listingId))
    .limit(1)
  return row ? { state: row.state, bid_count: row.bidCount } : null
}

/**
 * 유찰된 경매를 **같은 매물에서** 다시 연다(판매자). 입찰이 하나도 없이 끝난
 * 경매만 — 낙찰된 경매를 다시 열면 낙찰자에게 한 약속이 뒤집힌다.
 *
 * 조건부 UPDATE라 유찰이 아닌 경매에는 0행이다. 다시 열면 시작가·호가·기간을 새로
 * 받고, 매물 가격 칸(시작가)과 거래 상태(판매중)도 함께 맞춘다. 무효 처리된 옛
 * 입찰 기록은 남는다(이력).
 */
export async function relistNoBidAuction(
  listingId: string,
  auction: AuctionInput,
  now: Date
): Promise<boolean> {
  return withContentionRetry(() =>
    db.transaction(async tx => {
      const endsAt = new Date(now.getTime() + auction.duration_days * DAY_MS)
      const reopened = await tx
        .update(marketAuctions)
        .set({
          startPrice: auction.start_price,
          minIncrement: auction.min_increment,
          currentPrice: null,
          currentBidderId: null,
          bidCount: 0,
          endsAt,
          originalEndsAt: endsAt,
          state: 'live',
          winnerId: null,
          winningPrice: null,
          closedAt: null,
        })
        .where(and(eq(marketAuctions.listingId, listingId), eq(marketAuctions.state, 'no_bids')))
        .returning({ listingId: marketAuctions.listingId })
      if (reopened.length !== 1) return false
      await tx
        .update(marketListings)
        .set({ price: auction.start_price, status: 'open', statusChangedAt: now })
        .where(eq(marketListings.id, listingId))
      return true
    })
  )
}

/**
 * 진행 중 경매에 **살아 있는**(무효가 아닌) 입찰을 한 사람들. 관리자가 경매를
 * 내릴 때 알림 대상이다.
 */
export async function listActiveBidderIds(listingId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ bidderId: marketBids.bidderId })
    .from(marketBids)
    .where(and(eq(marketBids.listingId, listingId), isNull(marketBids.voidedAt)))
  return rows.map(row => row.bidderId)
}
