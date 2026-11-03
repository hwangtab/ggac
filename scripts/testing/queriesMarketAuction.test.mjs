import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/marketAuction.ts`를 실제 SQLite 파일 DB(마이그레이션 원장
 * 전부)로 검증한다. 경매의 약속 — 마감 뒤 입찰 불가 · 최소 호가 · 판매자 셀프
 * 입찰 불가 · 막판 연장 · 한 번만 닫힘 · 동시 입찰 중 하나만 이김 — 을 여기서
 * 고정한다. 시각은 `now`로 주입해 경계를 정확히 찌른다.
 */

const DB_PATH = 'scripts/testing/.queries-market-auction-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-11-01T00:00:00Z')
const at = ms => new Date(T0.getTime() + ms)

let setupClient
let auction
let market

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  auction = await import('../../src/db/queries/marketAuction.ts')
  market = await import('../../src/db/queries/market.ts')
  const { upsertProfile } = await import('../../src/db/queries/profiles.ts')
  for (const [id, name] of [
    ['seller', '판매자활동명'],
    ['alice', '앨리스'],
    ['bob', '밥'],
  ]) {
    await upsertProfile({
      id,
      email: `${id}@test.local`,
      display_name: name,
      registration_status: 'approved',
      is_active: true,
    })
  }
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

const fields = {
  title: '빈티지 기타 앰프',
  description: '소리 좋습니다',
  deal_type: 'auction',
  item_category: 'audio',
  price: null,
  condition: 'used',
  trade_method: 'direct',
  region: '수원',
  images: [],
}

async function open({ start = 10000, step = 1000, days = 1 } = {}) {
  const { id } = await auction.createAuctionListing(
    'seller',
    fields,
    { start_price: start, min_increment: step, duration_days: days },
    T0
  )
  return id
}

const bid = (listingId, bidderId, amount, now = at(1000)) =>
  auction.placeBid({ listingId, bidderId, amount, now })

test('경매 매물을 만들면 매물(시작가)과 경매 칸이 함께 생기고 진행 중이다', async () => {
  const id = await open()
  const row = await auction.getAuction(id)
  assert.equal(row.state, 'live')
  assert.equal(row.current_price, null)
  assert.equal(row.next_minimum, 10000)
  assert.equal(row.ends_at, at(DAY).toISOString())
  assert.equal(row.ends_at, row.original_ends_at)

  const listing = await market.getMarketListing(id)
  assert.equal(listing.deal_type, 'auction')
  assert.equal(listing.price, 10000)
  assert.equal(listing.auction.state, 'live')
})

test('첫 입찰은 시작가 이상이어야 하고, 다음부터는 현재가 + 호가 단위 이상이어야 한다', async () => {
  const id = await open()
  assert.deepEqual(await bid(id, 'alice', 9999), { error: 'too_low', minimum: 10000 })

  const first = await bid(id, 'alice', 10000)
  assert.equal(first.error, null)
  assert.equal(first.outbid_bidder_id, null)

  assert.deepEqual(await bid(id, 'bob', 10999), { error: 'too_low', minimum: 11000 })
  const second = await bid(id, 'bob', 11000)
  assert.equal(second.error, null)
  assert.equal(second.outbid_bidder_id, 'alice', '추월당한 사람이 알림 대상이다')

  const row = await auction.getAuction(id)
  assert.equal(row.current_price, 11000)
  assert.equal(row.current_bidder_name, '밥', '입찰자는 활동명으로 보인다')
  assert.equal(row.bid_count, 2)
  assert.equal(row.next_minimum, 12000)
})

test('자기 최고가를 스스로 올리면 추월 알림 대상이 없다', async () => {
  const id = await open()
  await bid(id, 'alice', 10000)
  const again = await bid(id, 'alice', 11000)
  assert.equal(again.error, null)
  assert.equal(again.outbid_bidder_id, null)
})

test('판매자는 자기 경매에 입찰하지 못한다', async () => {
  const id = await open()
  assert.deepEqual(await bid(id, 'seller', 50000), { error: 'self_bid' })
  assert.equal((await auction.getAuction(id)).bid_count, 0)
})

test('마감 시각 이후의 입찰은 거절된다(마감 시각 정각 포함)', async () => {
  const id = await open()
  assert.deepEqual(await bid(id, 'alice', 10000, at(DAY)), { error: 'ended' })
  assert.deepEqual(await bid(id, 'alice', 10000, at(DAY + 1)), { error: 'ended' })
  const justBefore = await bid(id, 'alice', 10000, at(DAY - 1))
  assert.equal(justBefore.error, null)
})

test('막판 2분 안의 입찰은 마감을 입찰 시각 + 2분으로 민다. 그 전 입찰은 마감을 건드리지 않는다', async () => {
  const id = await open()
  const early = await bid(id, 'alice', 10000, at(DAY - 10 * 60 * 1000))
  assert.equal(early.extended, false)
  assert.equal(early.ends_at, at(DAY).toISOString())

  const late = await bid(id, 'bob', 11000, at(DAY - 30 * 1000))
  assert.equal(late.extended, true)
  assert.equal(late.ends_at, at(DAY - 30 * 1000 + 2 * 60 * 1000).toISOString())

  const row = await auction.getAuction(id)
  assert.equal(row.original_ends_at, at(DAY).toISOString(), '처음 정한 마감은 남는다')

  // 원래 마감은 지났지만 연장된 마감 전이라 아직 입찰된다.
  const afterOriginal = await bid(id, 'alice', 12000, at(DAY + 1000))
  assert.equal(afterOriginal.error, null)
})

test('닫기: 마감 전에는 닫히지 않고, 마감 뒤에는 한 번만 닫힌다(낙찰 → 매물 예약중)', async () => {
  const id = await open()
  await bid(id, 'alice', 10000)
  await bid(id, 'bob', 15000)

  assert.equal(await auction.closeAuctionIfDue(id, at(DAY - 1)), null)

  const first = await auction.closeAuctionIfDue(id, at(DAY))
  assert.equal(
    await auction.closeAuctionIfDue(id, at(DAY + 1)),
    null,
    '두 번째는 닫을 게 없다(알림 한 번)'
  )
  assert.deepEqual(first, {
    listing_id: id,
    title: '빈티지 기타 앰프',
    seller_id: 'seller',
    state: 'ended',
    winner_id: 'bob',
    winning_price: 15000,
  })

  const row = await auction.getAuction(id)
  assert.equal(row.state, 'ended')
  assert.equal(row.winner_name, '밥')
  assert.equal((await market.getMarketListing(id)).status, 'reserved')

  assert.deepEqual(await bid(id, 'alice', 99000, at(DAY + 1)), { error: 'not_live' })
})

test('입찰 없이 마감되면 유찰이고 매물 상태는 그대로다', async () => {
  const id = await open()
  const closed = await auction.closeAuctionIfDue(id, at(DAY))
  assert.equal(closed.state, 'no_bids')
  assert.equal(closed.winner_id, null)
  assert.equal((await market.getMarketListing(id)).status, 'open')
})

test('마감 지난 경매 목록은 진행 중인 것만, 오래된 순으로', async () => {
  const due = await auction.listDueAuctionIds(at(DAY), 500)
  const live = await auction.listDueAuctionIds(at(0), 500)
  assert.ok(due.length > 0)
  assert.deepEqual(live, [])
  for (const id of due) assert.equal((await auction.getAuction(id)).state, 'live')
})

test('입찰 무효: 최고가가 남은 입찰에서 다시 계산되고, 닫힌 경매는 무효로 할 수 없다', async () => {
  const id = await open()
  await bid(id, 'alice', 10000)
  const top = await bid(id, 'bob', 90000) // 오타 입찰

  const voided = await auction.voidBid({
    bidId: top.bid_id,
    listingId: id,
    actorId: 'admin',
    now: at(2000),
  })
  assert.equal(voided.error, null)
  let row = await auction.getAuction(id)
  assert.equal(row.current_price, 10000)
  assert.equal(row.current_bidder_id, 'alice')
  assert.equal(row.bid_count, 1)
  assert.equal(row.next_minimum, 11000)

  const bids = await auction.listBids(id)
  assert.deepEqual(
    bids.map(b => [b.amount, b.voided]),
    [
      [90000, true],
      [10000, false],
    ]
  )

  assert.equal(
    (await auction.voidBid({ bidId: top.bid_id, listingId: id, actorId: 'admin', now: at(3000) }))
      .error,
    'already_voided'
  )

  // 다른 매물 경로로는 "없는 입찰"이다.
  const other = await open()
  const aliceBid = bids.find(b => b.amount === 10000)
  assert.equal(
    (
      await auction.voidBid({
        bidId: aliceBid.id,
        listingId: other,
        actorId: 'admin',
        now: at(3000),
      })
    ).error,
    'not_found'
  )

  // 남은 입찰까지 무효로 하면 시작가로 돌아간다.
  await auction.voidBid({ bidId: aliceBid.id, listingId: id, actorId: 'admin', now: at(4000) })
  row = await auction.getAuction(id)
  assert.equal(row.current_price, null)
  assert.equal(row.current_bidder_id, null)
  assert.equal(row.next_minimum, 10000)

  // 마감 뒤에는 무효로 할 수 없다(낙찰은 기록이다).
  const late = await bid(id, 'bob', 10000)
  assert.equal(
    (await auction.voidBid({ bidId: late.bid_id, listingId: id, actorId: 'admin', now: at(DAY) }))
      .error,
    'closed'
  )
})

test('취소: 진행 중인 경매만 취소되고, 취소된 경매에는 입찰할 수 없다', async () => {
  const id = await open()
  assert.equal(await auction.cancelLiveAuction(id, at(1000)), true)
  assert.equal(await auction.cancelLiveAuction(id, at(2000)), false)
  assert.deepEqual(await bid(id, 'alice', 10000), { error: 'not_live' })
  assert.equal(await auction.closeAuctionIfDue(id, at(DAY)), null, '취소된 경매는 닫히지 않는다')
})

test('삭제된 매물의 경매는 조회·입찰되지 않는다', async () => {
  const id = await open()
  await market.softDeleteMarketListing(id)
  assert.equal(await auction.getAuction(id), null)
  assert.deepEqual(await bid(id, 'alice', 10000), { error: 'not_found' })
})

test('소유권 조회는 경매 상태와 입찰 수를 함께 준다', async () => {
  const id = await open()
  await bid(id, 'alice', 10000)
  const owner = await market.getMarketListingOwner(id)
  assert.equal(owner.deal_type, 'auction')
  assert.equal(owner.auction_state, 'live')
  assert.equal(owner.auction_bid_count, 1)

  const { id: plain } = await market.createMarketListing('seller', {
    ...fields,
    deal_type: 'sell',
    price: 5000,
  })
  const plainOwner = await market.getMarketListingOwner(plain)
  assert.equal(plainOwner.auction_state, null)
  assert.equal(plainOwner.auction_bid_count, 0)
  assert.equal((await market.getMarketListing(plain)).auction, null)
})

test('판매자 취소(onlyWithoutBids)는 입찰이 들어온 경매를 취소하지 못한다 — 관리자 취소는 된다', async () => {
  const id = await open()
  await bid(id, 'alice', 10000)
  assert.equal(await auction.cancelLiveAuction(id, at(2000), { onlyWithoutBids: true }), false)
  assert.deepEqual(await auction.getAuctionState(id), { state: 'live', bid_count: 1 })
  assert.equal(await auction.cancelLiveAuction(id, at(3000)), true)
  assert.equal((await auction.getAuctionState(id)).state, 'canceled')

  const empty = await open()
  assert.equal(await auction.cancelLiveAuction(empty, at(1000), { onlyWithoutBids: true }), true)
})

test('닫을 게 없으면(일반 매물·마감 전) 쓰기 없이 null을 돌려준다', async () => {
  const { id: plain } = await market.createMarketListing('seller', {
    ...fields,
    deal_type: 'sell',
    price: 5000,
  })
  assert.equal(await auction.closeAuctionIfDue(plain, at(DAY * 30)), null)
  const id = await open()
  assert.equal(await auction.closeAuctionIfDue(id, at(DAY - 1)), null)
  assert.equal((await auction.getAuction(id)).state, 'live')
})

// 파일 맨 아래에 두고 **하나만** 둔다 — `queriesTicketing.test.mjs`와 같은 이유.
// 로컬 **파일** SQLite에 동시 쓰기를 걸면 COMMIT이 BUSY로 실패한 연결이 락을 쥔
// 채 남을 수 있어, 뒤 테스트의 쓰기가 검증 대상과 무관한 SQLITE_BUSY로 죽는다
// (실측). 운영 Turso는 서버가 쓰기를 직렬화한다. "동시에 닫아도 한 번만"은 같은
// 이유로 여기 두지 않는다 — 그 보장은 `state = 'live'` 조건 UPDATE가 지고, 위의
// "닫기" 테스트가 두 번째 닫기가 `null`임을 이미 본다.
test('동시에 들어온 같은 금액 입찰 둘 중 하나만 이긴다', async () => {
  const id = await open()
  const results = await Promise.allSettled([bid(id, 'alice', 10000), bid(id, 'bob', 10000)])
  const wins = results.filter(r => r.status === 'fulfilled' && r.value.error === null)
  assert.equal(wins.length, 1, JSON.stringify(results))

  const row = await auction.getAuction(id)
  assert.equal(row.bid_count, 1)
  const bids = await auction.listBids(id)
  assert.equal(bids.length, 1, '진 쪽의 입찰 기록이 남으면 안 된다')
  assert.equal(bids[0].bidder_id, row.current_bidder_id)
})
