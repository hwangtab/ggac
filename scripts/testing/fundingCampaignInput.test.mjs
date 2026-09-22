import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

// campaignInput.ts는 `@/db/schema/funding` 같은 tsconfig 경로 별칭을 정적
// import한다. 플레인 `node --test`의 ESM 리졸버는 번들러 전용 별칭인 `@/*`를
// 풀지 못하므로, 공용 해석 훅을 여기서 등록한다. 정적 import는 모듈 링크
// 단계에서 실행부보다 먼저 해석되므로, 훅 등록 뒤 동적 import로 가져온다.
registerAliasResolveHook(import.meta.url)

const { parseCampaignPatch, parseRewardList, isValidSlug } = await import(
  '../../src/lib/funding/campaignInput.ts'
)

test('all 범위: 제목·목표액 필수 형식, 허용 키만', () => {
  const r = parseCampaignPatch({ title: ' 첫 음반 ', summary: '요약', goal_amount: '1000000', status: 'active', category: '음반' }, 'all')
  assert.equal(r.ok, true)
  assert.deepEqual(r.patch, { title: '첫 음반', summary: '요약', goal_amount: 1000000, category: '음반' })
  assert.equal(parseCampaignPatch({ goal_amount: 0 }, 'all').ok, false)
  assert.equal(parseCampaignPatch({ category: '도박' }, 'all').ok, false)
  assert.equal(parseCampaignPatch({ summary: 'x'.repeat(201) }, 'all').ok, false)
})

test('summary는 정확히 200자까지 허용한다', () => {
  const r = parseCampaignPatch({ summary: 'x'.repeat(200) }, 'all')
  assert.equal(r.ok, true)
  assert.equal(r.patch.summary.length, 200)
})

test('title은 80자를 넘으면 자르지 않고 거절한다(한도를 메시지에 담는다)', () => {
  const ok = parseCampaignPatch({ title: 'x'.repeat(80) }, 'all')
  assert.equal(ok.ok, true)
  assert.equal(ok.patch.title.length, 80)
  const tooLong = parseCampaignPatch({ title: 'x'.repeat(81) }, 'all')
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.message, /80/)
})

test('goal_amount는 순수 정수만 허용한다 — 배열·지수 표기는 거절', () => {
  assert.equal(parseCampaignPatch({ goal_amount: [1000000] }, 'all').ok, false)
  assert.equal(parseCampaignPatch({ goal_amount: '1e6' }, 'all').ok, false)
  assert.equal(parseCampaignPatch({ goal_amount: 1.5 }, 'all').ok, false)
  assert.equal(parseCampaignPatch({ goal_amount: '1000000' }, 'all').ok, true)
})

test('start_at·end_at 형식이 잘못되면 거절한다', () => {
  assert.equal(parseCampaignPatch({ start_at: '이건-날짜가-아님' }, 'all').ok, false)
  assert.equal(parseCampaignPatch({ end_at: '이건-날짜가-아님' }, 'all').ok, false)
  assert.equal(parseCampaignPatch({ start_at: '2026-12-31T00:00:00Z' }, 'all').ok, true)
  assert.equal(parseCampaignPatch({ end_at: null }, 'all').ok, true)
})

test('contentOnly 범위: 본문 키 밖은 거절한다(조용히 버리지 않는다)', () => {
  assert.equal(parseCampaignPatch({ summary: 's', title: '바꿈' }, 'contentOnly').ok, false)
  const r = parseCampaignPatch({ story: '본문', end_at: '2026-12-31T00:00:00Z' }, 'contentOnly')
  assert.equal(r.ok, true)
  assert.deepEqual(Object.keys(r.patch).sort(), ['end_at', 'story'])
})

test('리워드 목록: 성공 시 파싱된 값 자체를 검사한다', () => {
  const ok = parseRewardList([
    { id: 'existing-id', title: ' CD ', description: '설명', amount: 30000, total_quantity: 10, requires_shipping: true, estimated_delivery: '2026-12', image_url: '/x.jpg', sort_order: 3 },
  ])
  assert.equal(ok.ok, true)
  assert.equal(ok.rewards.length, 1)
  assert.deepEqual(ok.rewards[0], {
    id: 'existing-id',
    title: 'CD',
    description: '설명',
    amount: 30000,
    total_quantity: 10,
    requires_shipping: true,
    estimated_delivery: '2026-12',
    image_url: '/x.jpg',
    sort_order: 3,
  })
})

test('리워드 목록: 새 리워드(id 없음)는 id가 undefined이고 순서는 배열 인덱스를 기본값으로 쓴다', () => {
  const ok = parseRewardList([{ title: 'A', amount: 1000 }, { title: 'B', amount: 2000 }])
  assert.equal(ok.ok, true)
  assert.equal(ok.rewards[0].id, undefined)
  assert.equal(ok.rewards[0].sort_order, 0)
  assert.equal(ok.rewards[1].sort_order, 1)
  assert.equal(ok.rewards[0].requires_shipping, false)
})

test('리워드 목록: 금액 양의 정수, 수량 null 또는 양의 정수', () => {
  const ok = parseRewardList([{ title: 'CD', amount: 30000, total_quantity: null, requires_shipping: true, sort_order: 0 }])
  assert.equal(ok.ok, true)
  assert.equal(parseRewardList([{ title: '', amount: 1 }]).ok, false)
  assert.equal(parseRewardList([{ title: 'a', amount: -1 }]).ok, false)
  assert.equal(parseRewardList([{ title: 'a', amount: 1, total_quantity: 0 }]).ok, false)
  assert.equal(parseRewardList('nope').ok, false)
  assert.equal(parseRewardList([]).ok, false)
})

test('리워드 금액은 정수가 아니면 거절한다', () => {
  assert.equal(parseRewardList([{ title: 'a', amount: 1.5 }]).ok, false)
  assert.equal(parseRewardList([{ title: 'a', amount: '삼만원' }]).ok, false)
})

test('리워드 개수는 20개까지 — 딱 20개는 되고 21개는 안 된다', () => {
  const make = n => Array.from({ length: n }, (_, i) => ({ title: `R${i}`, amount: 1000 + i }))
  assert.equal(parseRewardList(make(20)).ok, true)
  assert.equal(parseRewardList(make(21)).ok, false)
})

test('리워드 배송 필요 여부는 진짜 boolean만 받는다 — 문자열 "true"는 거절', () => {
  const stringTrue = parseRewardList([{ title: 'a', amount: 1000, requires_shipping: 'true' }])
  assert.equal(stringTrue.ok, false)
  const realTrue = parseRewardList([{ title: 'a', amount: 1000, requires_shipping: true }])
  assert.equal(realTrue.ok, true)
  assert.equal(realTrue.rewards[0].requires_shipping, true)
  const omitted = parseRewardList([{ title: 'a', amount: 1000 }])
  assert.equal(omitted.ok, true)
  assert.equal(omitted.rewards[0].requires_shipping, false)
})

test('리워드 예상 전달월은 YYYY-MM만 받는다', () => {
  assert.equal(parseRewardList([{ title: 'a', amount: 1000, estimated_delivery: '2026-12-25' }]).ok, false)
  assert.equal(parseRewardList([{ title: 'a', amount: 1000, estimated_delivery: '아무거나' }]).ok, false)
  const ok = parseRewardList([{ title: 'a', amount: 1000, estimated_delivery: '2026-12' }])
  assert.equal(ok.ok, true)
  assert.equal(ok.rewards[0].estimated_delivery, '2026-12')
  const absent = parseRewardList([{ title: 'a', amount: 1000 }])
  assert.equal(absent.ok, true)
  assert.equal(absent.rewards[0].estimated_delivery, null)
})

test('slug 형식', () => {
  assert.equal(isValidSlug('first-album-2026'), true)
  assert.equal(isValidSlug('First'), false)
  assert.equal(isValidSlug('a--b'), false)
  assert.equal(isValidSlug('ab'), false)
})

test('slug 길이 경계: 3자·60자는 되고 2자·61자는 안 된다', () => {
  assert.equal(isValidSlug('abc'), true)
  assert.equal(isValidSlug('ab'), false)
  assert.equal(isValidSlug('a'.repeat(60)), true)
  assert.equal(isValidSlug('a'.repeat(61)), false)
})
