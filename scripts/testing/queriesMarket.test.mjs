import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/market.ts`와 장터가 건드린 `uploads.ts`의 두 함수를 실제
 * SQLite 파일 DB(마이그레이션 원장 전부 적용)로 검증한다. 0024를 손으로 쓴
 * SQL과 `src/db/schema/market.ts`가 어긋나면 여기서 깨진다.
 */

const DB_PATH = 'scripts/testing/.queries-market-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let setupClient
let market
let uploads
let sellerId
let buyerId

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)

  market = await import('../../src/db/queries/market.ts')
  uploads = await import('../../src/db/queries/uploads.ts')
  const { upsertProfile } = await import('../../src/db/queries/profiles.ts')
  for (const [id, name] of [
    ['market-seller', '판매자'],
    ['market-buyer', '문의자'],
  ]) {
    await upsertProfile({
      id,
      email: `${id}@test.local`,
      display_name: name,
      registration_status: 'approved',
      is_active: true,
    })
  }
  sellerId = 'market-seller'
  buyerId = 'market-buyer'
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

const fields = (overrides = {}) => ({
  title: '중고 오디오 인터페이스',
  description: '잘 됩니다',
  deal_type: 'sell',
  item_category: 'audio',
  price: 120000,
  condition: 'good',
  trade_method: 'direct',
  region: '수원',
  images: [],
  ...overrides,
})

test('생성한 매물을 상세로 읽으면 모든 칸이 그대로이고 기본 상태는 판매중이다', async () => {
  const { id } = await market.createMarketListing(
    sellerId,
    fields({ images: ['https://x/1.webp'] })
  )
  const row = await market.getMarketListing(id)
  assert.equal(row.seller_name, '판매자')
  assert.equal(row.status, 'open')
  assert.equal(row.price, 120000)
  assert.deepEqual(row.images, ['https://x/1.webp'])
  assert.equal(row.comment_count, 0)
  assert.equal(row.status_changed_at, null)
})

test('목록: 최신순, 썸네일은 첫 사진, 본문은 싣지 않는다', async () => {
  const { id } = await market.createMarketListing(
    sellerId,
    fields({ title: '최신 매물', images: ['https://x/a.webp', 'https://x/b.webp'] })
  )
  const { rows } = await market.listMarketListings({ offset: 0, limit: 50 })
  assert.equal(rows[0].id, id)
  assert.equal(rows[0].thumbnail, 'https://x/a.webp')
  assert.equal('description' in rows[0], false)
})

test('목록 필터: 거래완료 숨기기·거래유형·품목·판매자', async () => {
  const done = await market.createMarketListing(sellerId, fields({ title: '끝난 매물' }))
  await market.updateMarketListingStatus(done.id, 'done')
  const free = await market.createMarketListing(
    buyerId,
    fields({ deal_type: 'free', price: 0, item_category: 'books' })
  )

  const visible = await market.listMarketListings({ hideDone: true, offset: 0, limit: 50 })
  assert.ok(!visible.rows.some(r => r.id === done.id))

  const all = await market.listMarketListings({ offset: 0, limit: 50 })
  assert.ok(all.rows.some(r => r.id === done.id))

  const frees = await market.listMarketListings({ dealType: 'free', offset: 0, limit: 50 })
  assert.deepEqual(
    frees.rows.map(r => r.id),
    [free.id]
  )

  const books = await market.listMarketListings({ itemCategory: 'books', offset: 0, limit: 50 })
  assert.deepEqual(
    books.rows.map(r => r.id),
    [free.id]
  )

  const mine = await market.listMarketListings({ sellerId: buyerId, offset: 0, limit: 50 })
  assert.deepEqual(
    mine.rows.map(r => r.id),
    [free.id]
  )
})

test('페이지: limit+1로 다음 페이지 유무를 안다', async () => {
  const first = await market.listMarketListings({ offset: 0, limit: 1 })
  assert.equal(first.rows.length, 1)
  assert.equal(first.hasNext, true)
})

test('상태 변경은 status_changed_at을 남긴다', async () => {
  const { id } = await market.createMarketListing(sellerId, fields())
  await market.updateMarketListingStatus(id, 'reserved')
  const row = await market.getMarketListing(id)
  assert.equal(row.status, 'reserved')
  assert.ok(row.status_changed_at)
})

test('부분 수정은 준 칸만 바꾼다', async () => {
  const { id } = await market.createMarketListing(sellerId, fields())
  await market.updateMarketListing(id, { title: '바뀐 제목', price: 99000 })
  const row = await market.getMarketListing(id)
  assert.equal(row.title, '바뀐 제목')
  assert.equal(row.price, 99000)
  assert.equal(row.region, '수원')
})

test('삭제된 매물은 상세·소유권 조회·목록 어디서도 나오지 않는다', async () => {
  const { id } = await market.createMarketListing(sellerId, fields())
  await market.softDeleteMarketListing(id)
  assert.equal(await market.getMarketListing(id), null)
  assert.equal(await market.getMarketListingOwner(id), null)
  const { rows } = await market.listMarketListings({ offset: 0, limit: 100 })
  assert.ok(!rows.some(r => r.id === id))
})

test('살아 있는 매물 수는 판매중·예약중만 센다(거래완료·삭제 제외)', async () => {
  const before = await market.countOpenListingsBySeller(buyerId)
  const a = await market.createMarketListing(buyerId, fields())
  const b = await market.createMarketListing(buyerId, fields())
  const c = await market.createMarketListing(buyerId, fields())
  await market.updateMarketListingStatus(a.id, 'reserved')
  await market.updateMarketListingStatus(b.id, 'done')
  await market.softDeleteMarketListing(c.id)
  assert.equal(await market.countOpenListingsBySeller(buyerId), before + 1)
})

test('댓글: 시간순, 삭제분은 본문 없이 자리만, 댓글 수는 살아 있는 것만', async () => {
  const { id } = await market.createMarketListing(sellerId, fields())
  const first = await market.createMarketComment({
    listingId: id,
    authorId: buyerId,
    content: '아직 있나요?',
  })
  await market.createMarketComment({ listingId: id, authorId: sellerId, content: '네 있어요' })
  await market.softDeleteMarketComment(first.id)

  const comments = await market.listMarketComments(id)
  assert.equal(comments.length, 2)
  assert.equal(comments[0].content, null)
  assert.equal(comments[0].is_deleted, true)
  assert.equal(comments[1].content, '네 있어요')
  assert.equal(comments[1].author_name, '판매자')

  assert.equal((await market.getMarketListing(id)).comment_count, 1)
  assert.deepEqual(await market.listMarketCommenterIds(id), [sellerId])

  const owner = await market.getMarketCommentOwner(first.id)
  assert.deepEqual(owner, { author_id: buyerId, listing_id: id, is_deleted: true })
})

test('업로드 소유 확인: 내가 올린 주소만 남기고 순서는 보존한다', async () => {
  await uploads.recordUpload({
    user_id: sellerId,
    bucket: 'attachments',
    path: 'p1',
    url: 'https://x/mine-1.webp',
  })
  await uploads.recordUpload({
    user_id: buyerId,
    bucket: 'attachments',
    path: 'p2',
    url: 'https://x/theirs.webp',
  })
  await uploads.recordUpload({
    user_id: sellerId,
    bucket: 'attachments',
    path: 'p3',
    url: 'https://x/mine-2.webp',
  })

  const owned = await uploads.filterUploadsOwnedBy(
    [
      'https://x/mine-2.webp',
      'https://x/theirs.webp',
      'https://evil/x.webp',
      'https://x/mine-1.webp',
    ],
    sellerId
  )
  assert.deepEqual(owned, ['https://x/mine-2.webp', 'https://x/mine-1.webp'])
  assert.deepEqual(await uploads.filterUploadsOwnedBy([], sellerId), [])
})

test('정리 크론: 살아 있는 매물의 사진은 후보가 아니고, 삭제된 매물의 사진은 후보다', async () => {
  const kept = 'https://x/market-kept.webp'
  const dropped = 'https://x/market-dropped.webp'
  for (const url of [kept, dropped]) {
    await uploads.recordUpload({ user_id: sellerId, bucket: 'attachments', path: url, url })
  }
  await market.createMarketListing(sellerId, fields({ images: [kept] }))
  const gone = await market.createMarketListing(sellerId, fields({ images: [dropped] }))
  await market.softDeleteMarketListing(gone.id)

  // 업로드 직후라 나이 조건을 0으로 둔다 — 여기서 보는 것은 참조 판정이다.
  const candidates = await uploads.listCleanupCandidates({ ageMs: -60_000 })
  const urls = candidates.map(c => c.url)
  assert.ok(!urls.includes(kept), '살아 있는 매물 사진이 정리 후보에 올랐다')
  assert.ok(urls.includes(dropped), '삭제된 매물 사진이 정리 후보에 없다')
})
