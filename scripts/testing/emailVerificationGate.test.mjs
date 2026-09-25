import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

/**
 * 이메일 인증 관문을 **실제 SQLite 파일 DB**로 검증한다. 소스에 함수 이름이
 * 있는지 세는 검사로는 "스위치가 실제로 무언가를 하는가"에 답할 수 없다 —
 * 이 화면이 앓았던 병이 정확히 그것이다.
 *
 * 관문이 실제로 걸리는 자리(`POST /api/auth/sign-in/email`)는
 * `e2e/authz-email-verification.spec.ts`가 돌아가는 서버에 진짜 로그인 요청을
 * 보내 확인한다. 이 파일은 판정 자체를 맡는다.
 *
 * `SETTINGS_CACHE_TTL_MS=0`: 설정 캐시가 기본 5분이라 껐다 켠 값이 바로
 * 보이지 않는다(featureSettings.test.mjs와 같은 이유).
 */

const DB_PATH = 'scripts/testing/.email-verification-gate-test.db'

process.env.SETTINGS_CACHE_TTL_MS = '0'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

registerAliasResolveHook(import.meta.url)

let client

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

beforeEach(async () => {
  await client.execute(`DELETE FROM system_settings WHERE category = 'security'`)
  await client.execute(`DELETE FROM member_profiles`)
  await client.execute(`DELETE FROM user`)
})

const { isEmailVerificationEnforced, refusesUnverifiedLogin, EMAIL_NOT_VERIFIED_MESSAGE } =
  await import('../../src/lib/auth/emailVerificationGate.ts')
const { getLoginVerificationSubject, countUnverifiedApprovedMembers } = await import(
  '../../src/db/queries/profiles.ts'
)

let rowSeq = 0
async function putEmailVerificationSetting(value) {
  await client.execute({
    sql: `INSERT INTO system_settings (id, category, setting_key, setting_value, is_sensitive, created_at, updated_at)
          VALUES (?, 'security', 'email_verification', ?, 0, ?, ?)`,
    args: [`ev-test-${++rowSeq}`, JSON.stringify(value), Date.now(), Date.now()],
  })
}

let userSeq = 0
async function putMember({ email, emailVerified, isAdmin = false, status = 'approved' }) {
  const id = `00000000-0000-4000-8000-0000000e${String(++userSeq).padStart(4, '0')}`
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, `test-${userSeq}`, email, emailVerified ? 1 : 0, now, now],
  })
  await client.execute({
    sql: `INSERT INTO member_profiles
            (id, display_name, email, registration_status, is_active, is_admin, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    args: [id, `조합원${userSeq}`, email, status, isAdmin ? 1 : 0, now, now],
  })
  return id
}

// ------------------------------------------------------------ 꺼져 있는 것이 기본

test('행이 아예 없으면 관문은 꺼져 있다', async () => {
  assert.equal(await isEmailVerificationEnforced(), false)
})

test('운영에 남아 있는 옛 값(required: true)은 관문을 켜지 못한다', async () => {
  // 배포 직후의 운영 행 모양 그대로다. 이 칸을 읽었다면 배포하는 순간
  // 미인증 회원이 문 앞에서 막혔을 것이다.
  await putEmailVerificationSetting({ required: true, token_expiry_hours: 24, resend_limit: 3 })
  assert.equal(await isEmailVerificationEnforced(), false)
})

test('값이 깨져 있어도 켜지지 않는다 — 켜는 것은 명시적인 true뿐이다', async () => {
  for (const value of [
    { enforce_on_login: 'yes' },
    { enforce_on_login: 1 },
    { enforce_on_login: null },
    {},
    [],
    'enabled',
  ]) {
    await client.execute(`DELETE FROM system_settings WHERE category = 'security'`)
    await putEmailVerificationSetting(value)
    assert.equal(await isEmailVerificationEnforced(), false, JSON.stringify(value))
  }
})

test('설정을 읽지 못하면 관문은 열려 있다 — 조회 한 번이 전 조합원의 로그인을 막지 않는다', async () => {
  await putEmailVerificationSetting({ enforce_on_login: true })
  assert.equal(await isEmailVerificationEnforced(), true)

  // 조회를 **실제로** 실패시킨다. 환경변수만 바꾸면 클라이언트가 이미
  // 만들어진 뒤라 아무 일도 일어나지 않고, 그 상태의 단정은 아무것도
  // 증명하지 못한다(같은 함정을 기능 스위치 테스트가 밟고 있다).
  await client.execute(`ALTER TABLE system_settings RENAME TO system_settings_hidden`)
  try {
    assert.equal(await isEmailVerificationEnforced(), false)
  } finally {
    await client.execute(`ALTER TABLE system_settings_hidden RENAME TO system_settings`)
  }

  // 되돌리면 다시 켜진다 — 위의 false가 "늘 false"가 아니었음을 보인다.
  assert.equal(await isEmailVerificationEnforced(), true)
})

test('켜면 켜진다', async () => {
  await putEmailVerificationSetting({ enforce_on_login: true, required: true })
  assert.equal(await isEmailVerificationEnforced(), true)
})

// ------------------------------------------------------------ 누구를 돌려보내는가

test('인증하지 않은 조합원은 돌려보낸다', async () => {
  await putMember({ email: 'unverified@ggac.test', emailVerified: false })
  const subject = await getLoginVerificationSubject('unverified@ggac.test')
  assert.equal(subject.email_verified, false)
  assert.equal(refusesUnverifiedLogin(subject), true)
})

test('인증한 조합원은 아무 영향이 없다', async () => {
  await putMember({ email: 'verified@ggac.test', emailVerified: true })
  const subject = await getLoginVerificationSubject('verified@ggac.test')
  assert.equal(subject.email_verified, true)
  assert.equal(refusesUnverifiedLogin(subject), false)
})

test('관리자는 인증하지 않았어도 돌려보내지 않는다 — 끌 사람이 남아야 한다', async () => {
  await putMember({ email: 'admin@ggac.test', emailVerified: false, isAdmin: true })
  const subject = await getLoginVerificationSubject('admin@ggac.test')
  assert.equal(subject.is_admin, true)
  assert.equal(refusesUnverifiedLogin(subject), false)
})

test('없는 주소는 이 관문이 다루지 않는다', async () => {
  assert.equal(await getLoginVerificationSubject('nobody@ggac.test'), null)
  assert.equal(refusesUnverifiedLogin(null), false)
  assert.equal(refusesUnverifiedLogin(undefined), false)
})

test('프로필이 없는 계정(유령 회원)은 관리자로 취급하지 않는다', async () => {
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, ?)`,
    args: ['00000000-0000-4000-8000-0000000effff', 'orphan', 'orphan@ggac.test', now, now],
  })
  const subject = await getLoginVerificationSubject('orphan@ggac.test')
  assert.equal(subject.is_admin, false)
  assert.equal(refusesUnverifiedLogin(subject), true)
})

test('거절 문구가 무슨 일인지와 빠져나오는 길을 함께 말한다', () => {
  assert.match(EMAIL_NOT_VERIFIED_MESSAGE, /이메일 인증/)
  assert.match(EMAIL_NOT_VERIFIED_MESSAGE, /다시 받을 수 있습니다/)
})

// ------------------------------------------------------------ 켜기 전에 비용을 센다

test('승인 회원 중 미인증자 수를 센다 — 관리자는 따로 센다', async () => {
  await putMember({ email: 'a@ggac.test', emailVerified: true })
  await putMember({ email: 'b@ggac.test', emailVerified: true })
  await putMember({ email: 'c@ggac.test', emailVerified: false })
  await putMember({ email: 'd@ggac.test', emailVerified: false, isAdmin: true })
  // 승인되지 않은 사람은 세지 않는다.
  await putMember({ email: 'e@ggac.test', emailVerified: false, status: 'pending' })

  assert.deepEqual(await countUnverifiedApprovedMembers(), {
    approved: 4,
    unverified: 2,
    unverified_admins: 1,
  })
})

test('로그인 수단 없는 프로필은 세지 않는다', async () => {
  // `user` 행 없이 프로필만 있는 경우 — 세어 봐야 막힐 사람이 아니다.
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO member_profiles
            (id, display_name, email, registration_status, is_active, is_admin, created_at, updated_at)
          VALUES (?, ?, ?, 'approved', 1, 0, ?, ?)`,
    args: ['00000000-0000-4000-8000-0000000eaaaa', '유령', 'ghost@ggac.test', now, now],
  })
  assert.deepEqual(await countUnverifiedApprovedMembers(), {
    approved: 0,
    unverified: 0,
    unverified_admins: 0,
  })
})
