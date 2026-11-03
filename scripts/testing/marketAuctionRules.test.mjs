import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  blockEdit,
  blockSellerDelete,
  blockStatusChange,
} from '../../src/lib/market/auctionRules.ts'
import {
  parseAuctionInput,
  parseBidAmount,
  parseMarketListingInput,
} from '../../src/lib/market/validate.ts'
import { buildAuctionClosedNotices } from '../../src/lib/server/marketAuctionNotify.ts'

/**
 * 경매의 약속(쓰기 규칙)·경매 입력 검증·종료 알림 문장. 부수효과가 없어 DB 없이
 * 분기를 전부 고정한다. 라우트는 이 결과를 그대로 400 메시지·알림으로 쓴다.
 */

const live = (bids = 0) => ({
  deal_type: 'auction',
  auction_state: 'live',
  auction_bid_count: bids,
})
const plain = { deal_type: 'sell', auction_state: null, auction_bid_count: 0 }

test('수정: 입찰 없는 진행 중 경매만 고칠 수 있다', () => {
  assert.equal(blockEdit(live(0), 'auction'), null)
  assert.match(blockEdit(live(1), 'auction'), /입찰이 들어온/)
  assert.match(blockEdit({ ...live(0), auction_state: 'ended' }, 'auction'), /끝난 경매/)
  assert.match(blockEdit({ ...live(0), auction_state: 'no_bids' }, 'auction'), /끝난 경매/)
})

test('수정: 경매 ↔ 일반 거래 전환은 어느 방향이든 막는다', () => {
  assert.match(blockEdit(live(0), 'sell'), /거래 유형/)
  assert.match(blockEdit(plain, 'auction'), /거래 유형/)
  assert.equal(blockEdit(plain, 'free'), null)
})

test('상태 변경: 진행 중 경매만 막고, 끝난 경매와 일반 매물은 연다', () => {
  assert.match(blockStatusChange(live(3)), /진행 중/)
  assert.equal(blockStatusChange({ ...live(3), auction_state: 'ended' }), null)
  assert.equal(blockStatusChange(plain), null)
})

test('판매자 삭제: 입찰이 들어온 진행 중 경매만 막고, 관리자는 언제나 통과', () => {
  assert.match(blockSellerDelete(live(1), false), /사무국/)
  assert.equal(blockSellerDelete(live(1), true), null)
  assert.equal(blockSellerDelete(live(0), false), null)
  assert.equal(blockSellerDelete({ ...live(1), auction_state: 'ended' }, false), null)
  assert.equal(blockSellerDelete(plain, false), null)
})

test('경매 매물은 일반 가격 칸을 요구하지 않는다(가격은 경매 칸이 가진다)', () => {
  const parsed = parseMarketListingInput({
    title: '빈티지 앰프',
    description: '설명',
    deal_type: 'auction',
    item_category: 'audio',
    price: '',
  })
  assert.equal(parsed.error, null)
  assert.equal(parsed.value.price, null)
})

test('경매 입력: 시작가 하한·호가 범위·허용 기간만 통과', () => {
  const ok = parseAuctionInput({ start_price: '10,000', min_increment: '1000', duration_days: '3' })
  assert.deepEqual(ok, {
    error: null,
    value: { start_price: 10000, min_increment: 1000, duration_days: 3 },
  })

  for (const body of [
    { start_price: 999, min_increment: 1000, duration_days: 3 },
    { start_price: '', min_increment: 1000, duration_days: 3 },
    { start_price: 10000, min_increment: 99, duration_days: 3 },
    { start_price: 10000, min_increment: 1_000_001, duration_days: 3 },
    { start_price: 10000, min_increment: 1000, duration_days: 2 },
    { start_price: 10000, min_increment: 1000, duration_days: 'x' },
  ]) {
    assert.ok(parseAuctionInput(body).error, JSON.stringify(body))
  }
})

test('입찰 금액: 양의 정수(콤마 허용)만', () => {
  assert.equal(parseBidAmount('12,000'), 12000)
  assert.equal(parseBidAmount(12000), 12000)
  for (const v of [0, -1, 1.5, '', null, undefined, 'abc', 100_000_001]) {
    assert.equal(parseBidAmount(v), null, String(v))
  }
})

test('종료 알림: 낙찰이면 낙찰자·판매자 두 통(판매자에게 낙찰자 활동명), 유찰이면 판매자 한 통', () => {
  const base = { listing_id: 'L', title: '앰프', seller_id: 'S', winning_price: 15000 }
  const sold = buildAuctionClosedNotices({ ...base, state: 'ended', winner_id: 'W' }, '밥')
  assert.deepEqual(
    sold.map(n => [n.user_id, n.type]),
    [
      ['W', 'market_auction_won'],
      ['S', 'market_auction_ended'],
    ]
  )
  assert.match(sold[0].message, /15,000원/)
  assert.match(sold[1].message, /밥 님/)

  const unsold = buildAuctionClosedNotices(
    { ...base, state: 'no_bids', winner_id: null, winning_price: null },
    null
  )
  assert.deepEqual(
    unsold.map(n => [n.user_id, n.type]),
    [['S', 'market_auction_ended']]
  )
  assert.match(unsold[0].title, /유찰/)
})
