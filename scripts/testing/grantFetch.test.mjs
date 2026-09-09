import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

/**
 * kosmart 호출의 요청 형태만 고정한다 — 판정은 grantDigest.ts 쪽 테스트가 본다.
 * 네트워크는 globalThis.fetch를 갈아 끼워 막는다.
 */
const { fetchGrantOpportunities, REQUESTED_CATEGORIES } = await import(
  '../../src/lib/server/grantFetch.ts'
)

const realFetch = globalThis.fetch
let requested = []

/** 실데이터 형태 한 건. requires_business는 kosmart가 새로 싣는 필드다. */
function payloadItem(over = {}) {
  return {
    key: 'artnuri:1',
    source: 'artnuri',
    source_id: '1',
    title: '2026년 음악 창작지원',
    genres: ['음악'],
    regions: ['경기'],
    category: 'grant',
    apply_start: null,
    apply_end: '2026-10-15',
    url: 'https://example.test/1',
    summary: null,
    biz_type: null,
    target: null,
    ...over,
  }
}

beforeEach(() => {
  requested = []
  process.env.KOSMART_OPPORTUNITIES_URL = 'https://kosmart.test/api/public/opportunities'
  process.env.KOSMART_API_TOKEN = 'test-token'
  globalThis.fetch = async url => {
    requested.push(new URL(url))
    return new Response(JSON.stringify({ items: [payloadItem()] }), { status: 200 })
  }
})

afterEach(() => {
  globalThis.fetch = realFetch
})

test('요청에 categories=grant,gig,audition이 실린다', async () => {
  await fetchGrantOpportunities({ genres: ['음악'], regions: ['경기', '서울'] })
  assert.equal(requested.length, 1)
  assert.equal(requested[0].searchParams.get('categories'), 'grant,gig,audition')
  assert.deepEqual([...REQUESTED_CATEGORIES], ['grant', 'gig', 'audition'])
})

test('기존 파라미터는 그대로 유지된다', async () => {
  await fetchGrantOpportunities({ genres: ['음악'], regions: ['경기', '서울'] })
  const p = requested[0].searchParams
  assert.equal(p.get('genres'), '음악')
  assert.equal(p.get('regions'), '경기,서울')
  assert.equal(p.get('strictRegion'), 'true')
  assert.equal(p.get('days'), '90')
})

test('categories를 모르는 배포의 응답(파라미터 무시)도 그대로 파싱한다', async () => {
  // life 계열이 섞여 와도 파싱은 성공해야 한다 — 거르는 것은 buildDraftItems의 몫이다.
  globalThis.fetch = async url => {
    requested.push(new URL(url))
    return new Response(
      JSON.stringify({
        items: [payloadItem(), payloadItem({ key: 'myhome:9', category: 'housing' })],
      }),
      { status: 200 }
    )
  }
  const blocks = await fetchGrantOpportunities({ genres: ['음악'], regions: ['경기'] })
  assert.deepEqual(
    blocks[0].items.map(i => i.key),
    ['artnuri:1', 'myhome:9']
  )
})

test('requires_business가 없는 옛 응답도 형식 검사를 통과한다', async () => {
  const blocks = await fetchGrantOpportunities({ genres: ['음악'], regions: ['경기'] })
  assert.equal(blocks[0].items[0].requires_business, undefined)
  assert.ok(!('requires_business' in blocks[0].items[0]))
})

test('모르는 필드는 저장 객체에 담기지 않는다 (관리자 PATCH 400 방어)', async () => {
  // 원본을 통째로 저장하면 kosmart가 필드를 늘릴 때마다 PATCH의 .strict() 스키마가
  // 그 회차의 저장을 전부 400으로 막는다.
  globalThis.fetch = async url => {
    requested.push(new URL(url))
    return new Response(
      JSON.stringify({
        items: [
          payloadItem({
            requires_business: false,
            source_label: '예술나루',
            score: 12.5,
            match_tier: 'exact',
          }),
        ],
      }),
      { status: 200 }
    )
  }
  const blocks = await fetchGrantOpportunities({ genres: ['음악'], regions: ['경기'] })
  const stored = blocks[0].items[0]
  assert.deepEqual(Object.keys(stored).sort(), [
    'apply_end',
    'apply_start',
    'biz_type',
    'category',
    'genres',
    'key',
    'regions',
    'requires_business',
    'source',
    'source_id',
    'summary',
    'target',
    'title',
    'url',
  ])
  assert.equal(stored.requires_business, false)
})

test('requires_business가 실려 오면 그대로 보존한다', async () => {
  globalThis.fetch = async url => {
    requested.push(new URL(url))
    return new Response(JSON.stringify({ items: [payloadItem({ requires_business: true })] }), {
      status: 200,
    })
  }
  const blocks = await fetchGrantOpportunities({ genres: ['음악'], regions: ['경기'] })
  assert.equal(blocks[0].items[0].requires_business, true)
})

test('저장되는 모든 필드가 관리자 PATCH 스키마에 있다 (저장은 되는데 편집이 안 되는 상태 방지)', async () => {
  const { readFileSync } = await import('node:fs')
  const routeSource = readFileSync(
    new URL('../../src/app/api/admin/grants/[id]/route.ts', import.meta.url),
    'utf8'
  )
  const schema = routeSource.slice(
    routeSource.indexOf('const itemSchema'),
    routeSource.indexOf('const patchSchema')
  )
  const blocks = await fetchGrantOpportunities({ genres: ['음악'], regions: ['경기'] })
  const stored = { ...blocks[0].items[0], requires_business: true }
  for (const field of Object.keys(stored)) {
    assert.ok(schema.includes(`${field}:`), `itemSchema에 ${field}가 없다`)
  }
})
