import { test } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'

const { hashPassword, verifyPassword, isBcryptHash } = await import(
  '../../src/lib/auth/password.ts'
)

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
