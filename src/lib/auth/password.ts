import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { ScryptOptions } from 'node:crypto'

import bcrypt from 'bcryptjs'

const KEY_LENGTH = 64
const HEX_RE = /^[0-9a-f]+$/i

/**
 * node:util의 promisify(scrypt)는 콜백 오버로드 중 옵션 없는 3-인자
 * 시그니처만 타입으로 노출해, options를 넘기면 타입 에러가 난다(런타임은
 * 문제없음). 직접 Promise로 감싸 옵션 인자를 온전히 타입에 반영한다.
 */
function scryptAsync(
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/**
 * 신규 해시를 만들 때 쓰는 scrypt 비용 파라미터.
 * Node의 scrypt 기본값(N=2^14, r=8, p=1)과 동일하다 — 기본 maxmem(32MB) 안에서
 * 안전하게 동작하고, 실측 약 38ms/1회로 서버리스 로그인 경로에 적합하다.
 * 저장된 해시 문자열에 매번 값을 함께 박아두므로, 이후 이 상수를 올려도
 * 이미 저장된 해시는 자신이 만들어질 때의 파라미터로 계속 검증된다.
 */
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

/**
 * Supabase GoTrue가 남긴 해시인지 판별한다.
 * 이관 사용자는 최초 로그인 시 이 경로로 검증된 뒤 자체 해시로 승격된다.
 */
export function isBcryptHash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${derived.toString('hex')}`
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  if (isBcryptHash(hash)) {
    // bcryptjs는 형식은 맞지만 내용이 손상된 해시(예: 유효 범위 밖 cost,
    // 손상된 salt)에 대해 동기적으로 예외를 던질 수 있다. 이관 대상 19명 중
    // 단 한 건이라도 해시가 손상되면 로그인 요청이 500으로 죽지 않고
    // 조용히 실패(false)해야 한다.
    try {
      return await bcrypt.compare(password, hash)
    } catch {
      return false
    }
  }

  const parts = hash.split(':')
  if (parts.length !== 6) return false

  const [scheme, nRaw, rRaw, pRaw, salt, stored] = parts
  if (scheme !== 'scrypt') return false
  if (!salt || !stored || !HEX_RE.test(salt) || !HEX_RE.test(stored)) return false

  const n = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  if (!Number.isInteger(n) || n <= 1) return false
  if (!Number.isInteger(r) || r <= 0) return false
  if (!Number.isInteger(p) || p <= 0) return false

  const storedBuffer = Buffer.from(stored, 'hex')
  if (storedBuffer.length !== KEY_LENGTH) return false

  try {
    const derived = await scryptAsync(password, salt, KEY_LENGTH, { N: n, r, p })
    if (storedBuffer.length !== derived.length) return false
    return timingSafeEqual(derived, storedBuffer)
  } catch {
    // 손상되었거나 악의적으로 조작된 파라미터(예: 2의 거듭제곱이 아닌 N,
    // maxmem을 초과하는 조합)는 Node의 scrypt 검증기가 동기/비동기로
    // 예외를 던진다 — 여기서도 예외 없이 false로 닫는다.
    return false
  }
}
