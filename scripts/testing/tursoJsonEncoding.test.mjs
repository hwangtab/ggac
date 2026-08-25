import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

import {
  JSON_ARRAY_COLUMN_CONTRACTS,
  findJsonEncodingViolations,
  formatJsonEncodingReport,
} from '../turso/check-json-encoding.mjs'

/**
 * `npm run db:parity`가 새로 보는 "JSON 값 인코딩" 가드를 실제 SQLite 파일
 * DB로 검증한다(단계 4 리뷰 1회차 Important 3).
 *
 * 운영 DB에는 접속하지 않는다 — 정상 행과 오염 행(`{음악,영상}`, Postgres
 * 배열 리터럴)을 로컬 파일 DB에 직접 심고, 오염 행에서 가드가 **실제로**
 * 실패하는지를 본다. 통과만 확인하면 가드가 아무것도 안 지키는 상태를
 * 못 잡는다.
 *
 * 여기서 부르는 `findJsonEncodingViolations`는 `scripts/turso/run-parity-check.mjs`
 * 가 부르는 바로 그 함수다(SQL을 테스트가 따로 베껴 쓰지 않는다).
 */

const DB_PATH = 'scripts/testing/.turso-json-encoding-test.db'

let client

async function insertArtist({ slug, category }) {
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO artists (
      id, legacy_id, slug, name, category,
      portfolio_links, youtube_videos, created_at, updated_at,
      profile_photo_metadata, is_active
    ) VALUES (?, ?, ?, ?, ?, '[]', '[]', ?, ?, '{}', 1)`,
    args: [crypto.randomUUID(), slug, slug, slug, category, now, now],
  })
}

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

test('계약 목록에 artists.category가 있다(가드가 아무 컬럼도 안 보는 상태를 막는다)', () => {
  assert.ok(
    JSON_ARRAY_COLUMN_CONTRACTS.some(c => c.table === 'artists' && c.column === 'category'),
    'artists.category가 JSON 배열 계약에서 빠지면 이 가드는 아무것도 안 지킨다'
  )
})

test('정상 행(JSON 배열)과 NULL만 있으면 위반 0건이다', async () => {
  await insertArtist({ slug: 'ok-array', category: JSON.stringify(['음악', '영상']) })
  await insertArtist({ slug: 'ok-empty-array', category: '[]' })
  await insertArtist({ slug: 'ok-null', category: null })

  const violations = await findJsonEncodingViolations(client)
  assert.deepEqual(violations, [], formatJsonEncodingReport(violations))
  assert.match(formatJsonEncodingReport(violations), /JSON 인코딩 통과/)
})

test('부정 대조: Postgres 배열 리터럴(`{음악,영상}`) 한 행이면 가드가 실제로 잡는다', async () => {
  await insertArtist({ slug: 'pg-array-literal', category: '{음악,영상}' })

  const violations = await findJsonEncodingViolations(client)
  assert.equal(violations.length, 1)
  assert.equal(violations[0].table, 'artists')
  assert.equal(violations[0].column, 'category')
  assert.equal(violations[0].label, 'pg-array-literal')
  assert.match(formatJsonEncodingReport(violations), /JSON 인코딩 위반: artists\.category/)

  await client.execute({ sql: 'DELETE FROM artists WHERE slug = ?', args: ['pg-array-literal'] })
  assert.deepEqual(await findJsonEncodingViolations(client), [])
})

test('부정 대조: 오염 행이 있으면 Drizzle 경로(listArtists)도 실제로 던진다 — 가드가 막는 사고가 실재한다', async () => {
  await insertArtist({ slug: 'pg-array-literal-2', category: '{음악,영상}' })

  const originalUrl = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
  try {
    const { listArtists } = await import(
      `${new URL('../../src/db/queries/artists.ts', import.meta.url).href}?t=${Date.now()}`
    )
    await assert.rejects(
      () => listArtists(),
      /JSON|json/,
      '오염 행 한 개가 목록 조회 전체를 던지게 만든다(그 예외를 getArtistsFromDB가 삼켜 조용히 낡은 JSON으로 폴백한다)'
    )
  } finally {
    process.env.TURSO_DATABASE_URL = originalUrl
    await client.execute({
      sql: 'DELETE FROM artists WHERE slug = ?',
      args: ['pg-array-literal-2'],
    })
  }
})

test('부정 대조: JSON이지만 배열이 아닌 값(문자열·객체)도 잡는다', async () => {
  await insertArtist({ slug: 'json-string', category: '"음악"' })
  await insertArtist({ slug: 'json-object', category: '{"genre":"음악"}' })

  const violations = await findJsonEncodingViolations(client)
  assert.deepEqual(
    violations.map(v => v.label).sort(),
    ['json-object', 'json-string'],
    'json_valid()만 보면 배열이 아닌 유효 JSON을 놓친다'
  )

  await client.execute("DELETE FROM artists WHERE slug IN ('json-string', 'json-object')")
})
