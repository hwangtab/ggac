import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import {
  assertColumnCoverage,
  buildUpsert,
  loadIdentity,
  verifyIdentity,
} from '../migrate/identity.mjs'
import {
  toArtistRow,
  toUserRow,
  toAccountRow,
  toMemberProfileRow,
  INTENTIONALLY_DEFAULTED,
} from '../migrate/lib/identityMapping.mjs'

const DB_PATH = 'scripts/testing/.migrate-loader-test.db'
let client

const PG_ARTIST = {
  id: 'a-uuid', legacy_id: 'artist-014', slug: 'hwang', name: '황경하',
  category: ['음악'], one_liner: '한 줄', bio: '소개', template_type: '콜라주형',
  portfolio_links: null, youtube_videos: [], contact: null,
  created_at: '2025-10-15T16:42:41.104671+00:00',
  updated_at: '2025-10-16T00:00:00+00:00',
  profile_photo_url: null, profile_photo_metadata: { w: 1 }, is_active: true,
  name_en: null, one_liner_en: null, bio_en: null, template_type_en: null,
}
const PG_PROFILE = {
  id: 'u1', display_name: '황경하', email: 'a@x.kr', phone_number: '010-0000-0000',
  birth_date: '1992-01-09', real_name: '황경하', monthly_fee: 30000,
  bank_name: '국민', account_number: '123-456', account_holder: '황경하',
  registration_status: 'approved', is_active: true, is_admin: true,
  created_at: '2025-10-15T16:42:41.104671+00:00', updated_at: '2025-10-16T00:00:00+00:00',
  approved_at: null, approved_by: null, last_login_at: null, rejected_by: null,
  suspension_reason: null, suspension_until: null, is_suspended: false,
  profile_completeness_score: 80,
  verification_status: { email: true, phone: false, identity: false },
  membership_type: 'regular', engagement_score: 3, is_member: true,
  artist_id: 'artist-014', is_artist: true, artist_role: 'owner',
  is_director: false, director_title: null, is_auditor: false,
}
const AUTH_USER = {
  id: 'u1', email: 'a@x.kr',
  encrypted_password: '$2a$10$01234567890123456789012345678901234567890123456789012',
  email_confirmed_at: '2025-10-15 16:42:41.104557+00',
  created_at: '2025-10-15 16:42:41.104557+00',
  updated_at: '2025-10-16 00:00:00+00',
}

function payload() {
  return {
    artists: [toArtistRow(PG_ARTIST)],
    users: [toUserRow(PG_PROFILE, AUTH_USER)],
    accounts: [toAccountRow(AUTH_USER)],
    profiles: [toMemberProfileRow(PG_PROFILE)],
  }
}

before(async () => {
  rmSync(DB_PATH, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  // 스키마는 커밋된 마이그레이션에서 그대로 가져온다 — 테스트가 자체 CREATE TABLE을
  // 들고 있으면 실제 스키마와 어긋나도 초록으로 통과한다.
  const { readFileSync } = await import('node:fs')
  await client.executeMultiple(readFileSync('src/db/migrations/0000_dizzy_krista_starr.sql', 'utf8'))
})

after(() => {
  client?.close()
  rmSync(DB_PATH, { force: true })
})

test('업서트 SQL은 파라미터 바인딩만 쓴다', () => {
  const { sql, args } = buildUpsert('user', toUserRow(PG_PROFILE, AUTH_USER))
  assert.match(sql, /^INSERT INTO "user"/)
  assert.match(sql, /ON CONFLICT\("id"\) DO UPDATE SET/)
  assert.equal(args.length, 7)
  assert.ok(!sql.includes('황경하'), 'SQL 본문에 값이 박혀서는 안 된다')
})

test('전 컬럼을 덮으면 커버리지 검사를 통과한다', async () => {
  await assertColumnCoverage(client, 'member_profiles', toMemberProfileRow(PG_PROFILE), [])
  await assertColumnCoverage(client, 'artists', toArtistRow(PG_ARTIST), [])
  await assertColumnCoverage(client, 'account', toAccountRow(AUTH_USER), INTENTIONALLY_DEFAULTED.account)
})

test('컬럼 하나가 빠지면 커버리지 검사가 던진다', async () => {
  const row = toMemberProfileRow(PG_PROFILE)
  delete row.monthly_fee
  await assert.rejects(
    () => assertColumnCoverage(client, 'member_profiles', row, []),
    /monthly_fee/
  )
})

test('테이블에 없는 키가 있으면 커버리지 검사가 던진다', async () => {
  const row = { ...toMemberProfileRow(PG_PROFILE), monthlyFee: 1 }
  await assert.rejects(
    () => assertColumnCoverage(client, 'member_profiles', row, []),
    /monthlyFee/
  )
})

test('허용목록에 적힌 컬럼은 비워도 통과한다', async () => {
  await assertColumnCoverage(client, 'account', toAccountRow(AUTH_USER), INTENTIONALLY_DEFAULTED.account)
  await assert.rejects(
    () => assertColumnCoverage(client, 'account', toAccountRow(AUTH_USER), []),
    /access_token/
  )
})

test('적재하면 네 테이블이 채워지고 값이 보존된다', async () => {
  const counts = await loadIdentity({ client, ...payload() })
  assert.deepEqual(counts, { artists: 1, user: 1, account: 1, member_profiles: 1 })

  const r = await client.execute('select * from member_profiles where id = ?', ['u1'])
  const row = r.rows[0]
  assert.equal(row.monthly_fee, 30000)
  assert.equal(row.account_number, '123-456')
  assert.equal(row.birth_date, '1992-01-09')
  assert.equal(row.is_active, 1)
  assert.equal(row.artist_id, 'artist-014')
  assert.equal(row.verification_status, '{"email":true,"phone":false,"identity":false}')

  const a = await client.execute('select portfolio_links, youtube_videos from artists')
  assert.equal(a.rows[0].portfolio_links, '[]')

  const acc = await client.execute('select provider_id, password from account')
  assert.equal(acc.rows[0].provider_id, 'credential')
  assert.equal(acc.rows[0].password, AUTH_USER.encrypted_password)
})

test('두 번 적재해도 행이 늘지 않는다 (멱등)', async () => {
  const counts = await loadIdentity({ client, ...payload() })
  assert.deepEqual(counts, { artists: 1, user: 1, account: 1, member_profiles: 1 })
  const r = await client.execute('select count(*) c from member_profiles')
  assert.equal(r.rows[0].c, 1)
})

test('검증은 일치할 때 불일치 0을 낸다', async () => {
  const { mismatches } = await verifyIdentity({ client, expected: payload() })
  assert.deepEqual(mismatches, [])
})

test('DB 값이 바뀌면 검증이 그 필드를 집어낸다', async () => {
  await client.execute('update member_profiles set monthly_fee = 1 where id = ?', ['u1'])
  const { mismatches } = await verifyIdentity({ client, expected: payload() })
  assert.equal(mismatches.length, 1)
  assert.match(mismatches[0], /member_profiles.*u1.*monthly_fee/)
  await client.execute('update member_profiles set monthly_fee = 30000 where id = ?', ['u1'])
})

test('행이 통째로 없으면 검증이 잡아낸다', async () => {
  await client.execute('delete from artists')
  const { mismatches } = await verifyIdentity({ client, expected: payload() })
  assert.ok(mismatches.some(m => /artists.*없음/.test(m)))
})
