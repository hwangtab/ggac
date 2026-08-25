import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * `src/db/queries/artists.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesActivities.test.mjs`(단계 4 Task 3)와 동일.
 */

const DB_PATH = 'scripts/testing/.queries-artists-test.db'
const ARTISTS_MODULE_URL = new URL('../../src/db/queries/artists.ts', import.meta.url)

async function loadFreshArtistsModule() {
  return import(`${ARTISTS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await setupClient.executeMultiple(
    readFileSync('src/db/migrations/0000_dizzy_krista_starr.sql', 'utf8')
  )
  await setupClient.executeMultiple(readFileSync('src/db/migrations/0001_neat_exiles.sql', 'utf8'))
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

// ---------------------------------------------------------------- 부정 대조: 깨진 경로

test('부정 대조 기반: listArtists가 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { listArtists } = await loadFreshArtistsModule()
    await assert.rejects(() => listArtists())
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
async function insertArtist(overrides = {}) {
  const n = ++seedCounter
  const id = crypto.randomUUID()
  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO artists (
      id, legacy_id, slug, name, category, one_liner, bio, template_type,
      portfolio_links, youtube_videos, contact, created_at, updated_at,
      profile_photo_url, profile_photo_metadata, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      overrides.legacyId ?? `artist-${String(n).padStart(3, '0')}`,
      overrides.slug ?? `artist-slug-${n}`,
      overrides.name ?? `아티스트${n}`,
      JSON.stringify(overrides.category ?? ['음악']),
      overrides.oneLiner ?? '한 줄 소개',
      overrides.bio ?? '소개글',
      overrides.templateType ?? '콜라주형',
      JSON.stringify(overrides.portfolioLinks ?? []),
      JSON.stringify(overrides.youtubeVideos ?? []),
      overrides.contact ?? 'artist@example.com',
      overrides.createdAt ?? now + n, // 순서 검증을 위해 미세하게 벌린다
      now,
      overrides.profilePhotoUrl ?? null,
      JSON.stringify(overrides.profilePhotoMetadata ?? {}),
      overrides.isActive === undefined ? 1 : overrides.isActive ? 1 : 0,
    ],
  })
  return { id, legacyId: overrides.legacyId ?? `artist-${String(n).padStart(3, '0')}` }
}

test('listArtists: created_at 오름차순으로 정렬된다', async () => {
  const a = await insertArtist({ createdAt: 3000 })
  const b = await insertArtist({ createdAt: 1000 })
  const c = await insertArtist({ createdAt: 2000 })

  const { listArtists } = await loadFreshArtistsModule()
  const rows = await listArtists()
  const ids = rows.map(r => r.id)
  const idxB = ids.indexOf(b.id)
  const idxC = ids.indexOf(c.id)
  const idxA = ids.indexOf(a.id)
  assert.ok(idxB < idxC && idxC < idxA, `오름차순이어야 한다 (b=${idxB}, c=${idxC}, a=${idxA})`)
})

test('listArtists: category(JSON 배열)가 문자열 배열로 그대로 돌아온다', async () => {
  await insertArtist({ category: ['음악', '미술'] })
  const { listArtists } = await loadFreshArtistsModule()
  const rows = await listArtists()
  const found = rows.find(r => Array.isArray(r.category) && r.category.includes('미술'))
  assert.ok(found)
  assert.deepEqual(found.category, ['음악', '미술'])
})

test('getArtistBySlug: 존재하면 행을, 없으면 null을 돌려준다', async () => {
  const { slug } = await (async () => {
    const inserted = await insertArtist({ slug: 'unique-slug-1' })
    return { slug: 'unique-slug-1', ...inserted }
  })()

  const { getArtistBySlug } = await loadFreshArtistsModule()
  const found = await getArtistBySlug(slug)
  assert.ok(found)
  assert.equal(found.slug, slug)

  const missing = await getArtistBySlug('no-such-slug')
  assert.equal(missing, null)
})

test('getArtistByLegacyId: legacy_id로 단건 조회. 존재하지 않으면 null', async () => {
  const { legacyId } = await insertArtist({ legacyId: 'artist-901' })
  const { getArtistByLegacyId } = await loadFreshArtistsModule()
  const found = await getArtistByLegacyId(legacyId)
  assert.ok(found)
  assert.equal(found.legacy_id, legacyId)

  const missing = await getArtistByLegacyId('artist-999')
  assert.equal(missing, null)
})

test('getArtistPhotoInfoByLegacyId: 사진 관련 컬럼만 돌려준다', async () => {
  const { legacyId } = await insertArtist({
    legacyId: 'artist-902',
    profilePhotoUrl: 'https://example.com/photo.webp',
    profilePhotoMetadata: { variants: { webp: 'x.webp' } },
  })
  const { getArtistPhotoInfoByLegacyId } = await loadFreshArtistsModule()
  const info = await getArtistPhotoInfoByLegacyId(legacyId)
  assert.equal(info.profile_photo_url, 'https://example.com/photo.webp')
  assert.deepEqual(info.profile_photo_metadata, { variants: { webp: 'x.webp' } })
})

test('updateArtistByLegacyId: 부분 갱신 — 지정하지 않은 필드는 그대로 남는다', async () => {
  const { legacyId } = await insertArtist({
    legacyId: 'artist-903',
    name: '원래이름',
    bio: '원래소개',
  })

  const { updateArtistByLegacyId } = await loadFreshArtistsModule()
  const updated = await updateArtistByLegacyId(legacyId, { name: '새이름' })
  assert.equal(updated.name, '새이름')
  assert.equal(updated.bio, '원래소개', '지정하지 않은 필드는 유지되어야 한다')
})

test('updateArtistByLegacyId: 존재하지 않는 legacy_id면 null을 돌려준다(throw하지 않는다)', async () => {
  const { updateArtistByLegacyId } = await loadFreshArtistsModule()
  const result = await updateArtistByLegacyId('artist-does-not-exist', { name: 'x' })
  assert.equal(result, null)
})

test('updateArtistByLegacyId: profile_photo_metadata를 null로 지우면 빈 객체로 저장된다(컬럼이 NOT NULL이라 undefined를 넣으면 안 된다)', async () => {
  const { legacyId } = await insertArtist({
    legacyId: 'artist-904',
    profilePhotoMetadata: { variants: { webp: 'x.webp' } },
  })
  const { updateArtistByLegacyId } = await loadFreshArtistsModule()
  const updated = await updateArtistByLegacyId(legacyId, {
    profile_photo_url: null,
    profile_photo_metadata: null,
  })
  assert.equal(updated.profile_photo_url, null)
  assert.deepEqual(updated.profile_photo_metadata, {})
})
