import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

/**
 * 내부 신청 폼을 쓰는 행사는 폼 유형이 **명시 등록**돼 있어야 한다.
 *
 * 폼 유형은 slug 정확 일치로 정하고 기본값이 'market'이라, 새 워크샵 slug를 등록하지
 * 않으면 조용히 판매 물건·상품 사진을 묻는 마켓 폼이 뜬다(홈레코딩 믹싱 워크샵 2회에서
 * 실제로 났다). 에러도 타입 오류도 없으므로 데이터와 등록 맵을 맞대어 잡는다.
 */

registerAliasResolveHook(import.meta.url)

const { EVENT_FORM_TYPES, getEventFormType } = await import(
  '../../src/constants/eventApplicationForms.ts'
)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const load = rel => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'))
const internalSlugs = rel =>
  load(rel)
    .filter(p => p.applicationForm?.internal === true)
    .map(p => p.slug)

for (const file of ['data/projects.json', 'data/en/projects.json']) {
  test(`${file}: 내부 신청 폼을 쓰는 행사는 폼 유형이 명시 등록돼 있다`, () => {
    const missing = internalSlugs(file).filter(slug => !(slug in EVENT_FORM_TYPES))
    assert.deepEqual(
      missing,
      [],
      `src/constants/eventApplicationForms.ts에 등록되지 않은 행사: ${missing.join(', ')}`
    )
  })
}

test('등록 맵에는 실제 프로젝트가 아닌 slug가 없다', () => {
  const slugs = new Set(load('data/projects.json').map(p => p.slug))
  const stale = Object.keys(EVENT_FORM_TYPES).filter(slug => !slugs.has(slug))
  assert.deepEqual(stale, [])
})

test('워크샵 2회는 워크샵 폼, 사운드마켓은 마켓 폼을 쓴다', () => {
  assert.equal(getEventFormType('home-recording-mixing-workshop'), 'workshop')
  assert.equal(getEventFormType('home-recording-mixing-workshop-2'), 'workshop')
  assert.equal(getEventFormType('suwon-sound-market-vol-2'), 'market')
})
