import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import bcrypt from 'bcryptjs'

const { hashPassword, verifyPassword, isBcryptHash } = await import(
  '../../src/lib/auth/password.ts'
)

const scryptAsync = promisify(scrypt)

test('bcrypt 해시를 식별한다', () => {
  assert.equal(isBcryptHash('$2a$10$abcdefghijklmnopqrstuv'), true)
  assert.equal(isBcryptHash('$2b$10$abcdefghijklmnopqrstuv'), true)
  assert.equal(isBcryptHash('$2y$10$abcdefghijklmnopqrstuv'), true)
  assert.equal(isBcryptHash('scrypt:abcdef'), false)
})

test('Supabase가 만든 bcrypt 해시를 검증한다', async () => {
  const supabaseStyleHash = bcrypt.hashSync('correct-horse', 10)
  assert.equal(
    await verifyPassword({ hash: supabaseStyleHash, password: 'correct-horse' }),
    true
  )
  assert.equal(await verifyPassword({ hash: supabaseStyleHash, password: 'wrong' }), false)
})

test('자체 해시를 만들고 되검증한다', async () => {
  const hash = await hashPassword('new-password-123')
  assert.equal(isBcryptHash(hash), false)
  assert.equal(await verifyPassword({ hash, password: 'new-password-123' }), true)
  assert.equal(await verifyPassword({ hash, password: 'other' }), false)
})

// --- 맬폼드 입력: 예외 없이 false만 반환해야 한다 ---
// 아래 각 케이스는 verifyPassword가 던지면 await 자체가 reject되어 테스트가
// 실패하므로, "예외 없음"과 "false 반환"을 동시에 검증한다.

test('빈 해시 문자열은 false', async () => {
  assert.equal(await verifyPassword({ hash: '', password: 'whatever' }), false)
})

test('60자 bcrypt 형식이지만 alphabet이 깨진 salt는 false (bcryptjs가 던지는 케이스)', async () => {
  const corruptSaltHash = '$2b$10$' + '!'.repeat(53)
  assert.equal(corruptSaltHash.length, 60)
  assert.equal(isBcryptHash(corruptSaltHash), true)
  assert.equal(await verifyPassword({ hash: corruptSaltHash, password: 'whatever' }), false)
})

test('범위를 벗어난 bcrypt cost(99)는 false (bcryptjs가 던지는 케이스)', async () => {
  const invalidCostHash = '$2b$99$' + 'a'.repeat(53)
  assert.equal(invalidCostHash.length, 60)
  assert.equal(isBcryptHash(invalidCostHash), true)
  assert.equal(await verifyPassword({ hash: invalidCostHash, password: 'whatever' }), false)
})

test('scrypt 해시인데 세그먼트가 부족하면(p 누락) false', async () => {
  // 정상 포맷: scrypt:N:r:p:salt:hash (6조각). p가 빠져 5조각.
  assert.equal(
    await verifyPassword({ hash: 'scrypt:16384:8:abcd:1234', password: 'whatever' }),
    false
  )
})

test('scrypt 해시인데 세그먼트가 과다하면 false', async () => {
  assert.equal(
    await verifyPassword({
      hash: 'scrypt:16384:8:1:abcd:1234:extra',
      password: 'whatever',
    }),
    false
  )
})

test('scrypt 해시의 salt가 hex가 아니면 false', async () => {
  assert.equal(
    await verifyPassword({
      hash: 'scrypt:16384:8:1:not-hex-zz:1234abcd',
      password: 'whatever',
    }),
    false
  )
})

test('scrypt 해시의 저장값이 hex가 아니면 false', async () => {
  assert.equal(
    await verifyPassword({
      hash: 'scrypt:16384:8:1:1234abcd:not-hex-zz',
      password: 'whatever',
    }),
    false
  )
})

test('scheme을 알아볼 수 없는 문자열은 false', async () => {
  assert.equal(
    await verifyPassword({ hash: 'not-a-hash-at-all', password: 'whatever' }),
    false
  )
  assert.equal(
    await verifyPassword({ hash: 'md5:deadbeef', password: 'whatever' }),
    false
  )
})

// --- 저장된 비용 파라미터를 그대로 신뢰해 검증한다 ---
// hashPassword가 현재 쓰는 기본 파라미터(N=16384)와 다른 파라미터로 만들어진
// 해시도, 해시 문자열 안에 박힌 파라미터로 재계산해 검증해야 한다.
// 이 속성이 있어야 나중에 SCRYPT_N 상수를 올려도 기존 해시가 깨지지 않는다.
test('저장된 해시의 비용 파라미터가 현재 기본값과 달라도 검증에 성공한다', async () => {
  const oldN = 8192 // 현재 기본값(16384)과 다른, 과거에 쓰였을 법한 비용
  const oldR = 8
  const oldP = 1
  const salt = randomBytes(16).toString('hex')
  const derived = await scryptAsync('legacy-cost-password', salt, 64, {
    N: oldN,
    r: oldR,
    p: oldP,
  })
  const legacyHash = `scrypt:${oldN}:${oldR}:${oldP}:${salt}:${derived.toString('hex')}`

  assert.equal(isBcryptHash(legacyHash), false)
  assert.equal(
    await verifyPassword({ hash: legacyHash, password: 'legacy-cost-password' }),
    true
  )
  assert.equal(await verifyPassword({ hash: legacyHash, password: 'wrong' }), false)
})
