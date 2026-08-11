import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

import bcrypt from 'bcryptjs'

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64

/**
 * Supabase GoTrue가 남긴 해시인지 판별한다.
 * 이관 사용자는 최초 로그인 시 이 경로로 검증된 뒤 자체 해시로 승격된다.
 */
export function isBcryptHash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  return `scrypt:${salt}:${derived.toString('hex')}`
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  if (isBcryptHash(hash)) {
    return bcrypt.compare(password, hash)
  }

  const [scheme, salt, stored] = hash.split(':')
  if (scheme !== 'scrypt' || !salt || !stored) return false

  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  const storedBuffer = Buffer.from(stored, 'hex')
  if (storedBuffer.length !== derived.length) return false

  return timingSafeEqual(derived, storedBuffer)
}
