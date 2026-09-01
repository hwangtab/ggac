import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/** `src/db/queries/grantDigests.ts`를 실제 SQLite 파일 DB로 검증한다.
 *  패턴은 `scripts/testing/queriesNotifications.test.mjs`와 동일. */

const DB_PATH = 'scripts/testing/.queries-grant-digests-test.db'
const MODULE_URL = new URL('../../src/db/queries/grantDigests.ts', import.meta.url)

async function loadFresh() {
  return import(`${MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

// ---------------------------------------------------------------- 부정 대조: 깨진 경로
//
// db/client.ts는 커넥션을 모듈 스코프 싱글턴(Proxy 지연 캐시)으로 들고 있다. 이 테스트가
// 정상 DB로 먼저 연결된 뒤 실행되면 TURSO_DATABASE_URL을 바꿔도 이미 캐시된 커넥션이
// 그대로 쓰여 던지지 않는다 — 그래서 다른 모든 queries*.test.mjs와 같이 이 스위트에서
// 가장 먼저 실행되게 둔다(패턴: queriesNotifications.test.mjs, queriesLikes.test.mjs).

test('DB에 접속하지 못하면 던진다 (조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-grant/broken.db'
  try {
    const m = await loadFresh()
    await assert.rejects(() => m.listGrantDigests(10))
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const ITEM = {
  key: 'ncas:1',
  source: 'ncas',
  source_id: '1',
  title: '음악 창작지원',
  genres: ['음악'],
  regions: ['경기'],
  category: 'grant',
  apply_start: '2026-09-01',
  apply_end: '2026-10-15',
  url: 'https://example.test/1',
  summary: null,
  biz_type: null,
  target: null,
}

test('회차를 만들고 week_key로 찾는다', async () => {
  const m = await loadFresh()
  const created = await m.createGrantDigest({ week_key: '2026-W36', items: [ITEM] })
  assert.equal(created.week_key, '2026-W36')
  assert.equal(created.status, 'draft')
  assert.equal(created.post_id, null)
  assert.equal(created.items.length, 1)
  assert.equal(created.items[0].key, 'ncas:1')
  assert.match(created.created_at, /^\d{4}-\d{2}-\d{2}T/)

  const found = await m.getGrantDigestByWeekKey('2026-W36')
  assert.equal(found.id, created.id)
})

test('없는 week_key는 null이다', async () => {
  const m = await loadFresh()
  assert.equal(await m.getGrantDigestByWeekKey('1999-W01'), null)
})

test('같은 week_key를 두 번 만들면 던진다 (회차 멱등키)', async () => {
  const m = await loadFresh()
  await m.createGrantDigest({ week_key: '2026-W37', items: [] })
  await assert.rejects(() => m.createGrantDigest({ week_key: '2026-W37', items: [] }))
})

test('items와 status를 갱신한다', async () => {
  const m = await loadFresh()
  const created = await m.createGrantDigest({ week_key: '2026-W38', items: [ITEM] })
  const updated = await m.updateGrantDigest(created.id, {
    items: [{ ...ITEM, excluded: true }],
    status: 'published',
    post_id: 'post-abc',
    published_at: '2026-09-08T00:00:00.000Z',
  })
  assert.equal(updated.status, 'published')
  assert.equal(updated.post_id, 'post-abc')
  assert.equal(updated.items[0].excluded, true)
  assert.match(updated.published_at, /^2026-09-08T/)
})

test('없는 id를 갱신하면 null이다', async () => {
  const m = await loadFresh()
  assert.equal(await m.updateGrantDigest('no-such-id', { status: 'discarded' }), null)
})

test('listRecentDigestItems는 최근 회차의 항목을 평평하게 모은다', async () => {
  const m = await loadFresh()
  await m.createGrantDigest({ week_key: '2026-W40', items: [{ ...ITEM, key: 'ncas:40' }] })
  await m.createGrantDigest({ week_key: '2026-W41', items: [{ ...ITEM, key: 'ncas:41' }] })
  const items = await m.listRecentDigestItems(12)
  const keys = items.map(i => i.key)
  assert.ok(keys.includes('ncas:40'))
  assert.ok(keys.includes('ncas:41'))
})

// ---------------------------------------------------------------- claimGrantDigestForPublish
//
// `UPDATE ... WHERE status='draft' RETURNING *` 한 문장이 조합원 중복 발송을
// 막는 유일한 불변식이다(발행 라우트의 read-check-act 경쟁 창을 없앤다). 이
// 스위트가 지워진 수동 curl 검증을 대체한다.

test('claimGrantDigestForPublish: draft 회차를 선점하면 publishing이 되고 행이 돌아온다', async () => {
  const m = await loadFresh()
  const created = await m.createGrantDigest({ week_key: '2026-W42', items: [ITEM] })
  assert.equal(created.status, 'draft')

  const claimed = await m.claimGrantDigestForPublish(created.id)
  assert.ok(claimed, '첫 선점은 행을 돌려줘야 한다')
  assert.equal(claimed.id, created.id)
  assert.equal(claimed.status, 'publishing')
})

test('claimGrantDigestForPublish: 같은 회차를 두 번째로 선점하면 null이다 (중복 발송을 막는 핵심 불변식)', async () => {
  const m = await loadFresh()
  const created = await m.createGrantDigest({ week_key: '2026-W43', items: [ITEM] })

  const first = await m.claimGrantDigestForPublish(created.id)
  assert.equal(first.status, 'publishing')

  const second = await m.claimGrantDigestForPublish(created.id)
  assert.equal(second, null, '이미 publishing인 회차를 다시 선점하면 null이어야 한다')

  // 세 번째 시도도 마찬가지 — 한 번 잠기면 계속 잠겨 있어야 한다.
  const third = await m.claimGrantDigestForPublish(created.id)
  assert.equal(third, null)
})

test('claimGrantDigestForPublish: 이미 published인 회차를 선점하면 null이다', async () => {
  const m = await loadFresh()
  const created = await m.createGrantDigest({ week_key: '2026-W44', items: [ITEM] })
  await m.updateGrantDigest(created.id, {
    status: 'published',
    published_at: '2026-11-02T00:00:00.000Z',
  })

  const claimed = await m.claimGrantDigestForPublish(created.id)
  assert.equal(claimed, null)
})

test('claimGrantDigestForPublish: 없는 id를 선점하면 null이다', async () => {
  const m = await loadFresh()
  assert.equal(await m.claimGrantDigestForPublish('no-such-digest-id'), null)
})
