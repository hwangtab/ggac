import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseMarketListingInput,
  parseMarketListQuery,
  parseMarketStatus,
} from '../../src/lib/market/validate.ts'
import { pickMarketCommentRecipients } from '../../src/lib/server/marketNotify.ts'
import { MARKET_IMAGES_MAX, MARKET_PRICE_MAX } from '../../src/constants/market.ts'

/**
 * 장터 쓰기 본문 검증과 댓글 알림 수신자 선택. 둘 다 부수효과가 없는 함수라
 * DB 없이 분기를 전부 고정한다. 라우트는 이 결과를 그대로 400 메시지로 쓴다.
 */

const base = {
  title: '야마하 디지털피아노',
  description: '2년 사용, 하자 없음',
  deal_type: 'sell',
  item_category: 'instrument',
  price: '350,000',
}

test('정상 판매 글: 콤마 가격을 정수로, 빈 선택 칸을 null로 저장한다', () => {
  const parsed = parseMarketListingInput({ ...base, condition: '', region: '  ' })
  assert.equal(parsed.error, null)
  assert.equal(parsed.value.price, 350000)
  assert.equal(parsed.value.condition, null)
  assert.equal(parsed.value.region, null)
  assert.deepEqual(parsed.value.images, [])
})

test('판매 글은 가격이 있어야 한다 — 0원 판매는 나눔으로 안내한다', () => {
  for (const price of [undefined, '', 0, '0']) {
    const parsed = parseMarketListingInput({ ...base, price })
    assert.match(parsed.error ?? '', /나눔/, `price=${String(price)}`)
  }
})

test('나눔은 입력칸에 남은 가격과 상관없이 0원으로 저장한다', () => {
  const parsed = parseMarketListingInput({ ...base, deal_type: 'free', price: '99999' })
  assert.equal(parsed.error, null)
  assert.equal(parsed.value.price, 0)
})

test('삽니다는 희망가를 비워 둘 수 있다(가격 협의)', () => {
  const parsed = parseMarketListingInput({ ...base, deal_type: 'buy', price: '' })
  assert.equal(parsed.error, null)
  assert.equal(parsed.value.price, null)
})

test('가격: 음수·소수·상한 초과·숫자 아님은 거절한다', () => {
  for (const price of [-1, 1.5, MARKET_PRICE_MAX + 1, 'abc']) {
    const parsed = parseMarketListingInput({ ...base, price })
    assert.ok(parsed.error, `price=${String(price)}`)
  }
})

test('허용 목록 밖의 거래 유형·품목·상태·거래방식은 거절한다', () => {
  assert.ok(parseMarketListingInput({ ...base, deal_type: 'auction' }).error)
  assert.ok(parseMarketListingInput({ ...base, item_category: 'car' }).error)
  assert.ok(parseMarketListingInput({ ...base, condition: 'broken' }).error)
  assert.ok(parseMarketListingInput({ ...base, trade_method: 'drone' }).error)
})

test('제목·설명: 공백만이거나 너무 짧으면 거절한다', () => {
  assert.ok(parseMarketListingInput({ ...base, title: '  a ' }).error)
  assert.ok(parseMarketListingInput({ ...base, description: '   ' }).error)
})

test('사진: https 주소만, 중복은 하나로, 상한 초과는 거절', () => {
  const url = 'https://blob.example.com/a.webp'
  const ok = parseMarketListingInput({ ...base, images: [url, url] })
  assert.deepEqual(ok.value.images, [url])

  for (const images of [
    ['http://blob.example.com/a.webp'],
    ['javascript:alert(1)'],
    ['/relative.webp'],
    [123],
    'https://blob.example.com/a.webp',
    Array.from({ length: MARKET_IMAGES_MAX + 1 }, (_, i) => `https://b.example.com/${i}.webp`),
  ]) {
    assert.ok(parseMarketListingInput({ ...base, images }).error, JSON.stringify(images))
  }
})

test('상태 값: 허용 목록만 통과한다', () => {
  assert.equal(parseMarketStatus('reserved'), 'reserved')
  assert.equal(parseMarketStatus('sold'), null)
  assert.equal(parseMarketStatus(undefined), null)
})

test('목록 쿼리: 모르는 값은 필터 없음으로, 페이지는 1 이상 정수만', () => {
  const q = parseMarketListQuery(new URLSearchParams('deal=x&item=audio&page=-3&hideDone=1'))
  assert.equal(q.dealType, undefined)
  assert.equal(q.itemCategory, 'audio')
  assert.equal(q.page, 1)
  assert.equal(q.hideDone, true)
  assert.equal(parseMarketListQuery(new URLSearchParams('page=2.5')).page, 1)
})

test('알림 수신자: 문의자가 쓰면 판매자에게만 간다(다른 문의자에게는 안 간다)', () => {
  assert.deepEqual(
    pickMarketCommentRecipients({
      sellerId: 'seller',
      actorId: 'buyer-b',
      priorCommenterIds: ['buyer-a', 'seller'],
    }),
    ['seller']
  )
})

test('알림 수신자: 판매자가 쓰면 그 글의 문의자 전원에게 간다(판매자 자신 제외)', () => {
  assert.deepEqual(
    pickMarketCommentRecipients({
      sellerId: 'seller',
      actorId: 'seller',
      priorCommenterIds: ['buyer-a', 'seller', 'buyer-b', 'buyer-a'],
    }),
    ['buyer-a', 'buyer-b']
  )
})

test('알림 수신자: 판매자가 혼자 남긴 댓글은 아무에게도 가지 않는다', () => {
  assert.deepEqual(
    pickMarketCommentRecipients({ sellerId: 's', actorId: 's', priorCommenterIds: ['s'] }),
    []
  )
})
