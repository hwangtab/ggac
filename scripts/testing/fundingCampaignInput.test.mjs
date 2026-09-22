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

test('contentOnly 범위: 본문 키 밖은 거절한다(조용히 버리지 않는다)', () => {
  assert.equal(parseCampaignPatch({ summary: 's', title: '바꿈' }, 'contentOnly').ok, false)
  const r = parseCampaignPatch({ story: '본문', end_at: '2026-12-31T00:00:00Z' }, 'contentOnly')
  assert.equal(r.ok, true)
  assert.deepEqual(Object.keys(r.patch).sort(), ['end_at', 'story'])
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

test('slug 형식', () => {
  assert.equal(isValidSlug('first-album-2026'), true)
  assert.equal(isValidSlug('First'), false)
  assert.equal(isValidSlug('a--b'), false)
  assert.equal(isValidSlug('ab'), false)
})
