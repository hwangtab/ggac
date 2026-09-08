/**
 * Resend 웹훅의 Svix 서명을 검증한다.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test`가 `.ts`를 읽을 때 쓰는 타입
 * 스트리핑 모드는 확장자 없는 로컬 import를 해석하지 못한다.
 *
 * `svix` 패키지를 들이지 않는 이유: 검증은 HMAC-SHA256 비교뿐이고 `node:crypto`로
 * 끝난다. 이 저장소는 이미 `timingSafeEqual`로 토큰을 비교한다
 * (`src/app/api/internal/**`).
 *
 * 알고리즘: `${id}.${timestamp}.${body}` 를 시크릿(base64 디코딩한 바이트)으로
 * HMAC-SHA256 한 뒤 base64. 헤더 `svix-signature` 는 `v1,<sig> v1,<sig2>` 처럼
 * 공백으로 이은 목록이며 키 교체 중에는 둘 이상이 온다.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type SvixHeaders = {
  id: string | null
  timestamp: string | null
  signature: string | null
}

export type SvixVerifyResult = { ok: true } | { ok: false; reason: string }

/** 재전송 공격 허용 오차. Svix 권장값과 같다. */
const TOLERANCE_SEC = 300

function safeEqualBase64(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'base64')
  const bufB = Buffer.from(b, 'base64')
  // 길이가 다르면 timingSafeEqual이 던진다. 길이 자체는 비밀이 아니다.
  if (bufA.length !== bufB.length || bufA.length === 0) return false
  return timingSafeEqual(bufA, bufB)
}

export function verifySvixSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  nowMs: number = Date.now()
): SvixVerifyResult {
  const trimmedSecret = secret?.trim()
  if (!trimmedSecret) {
    return { ok: false, reason: 'signing secret is not configured' }
  }
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: 'missing svix headers' }
  }

  const timestampSec = Number(headers.timestamp)
  if (!Number.isFinite(timestampSec)) {
    return { ok: false, reason: 'invalid timestamp' }
  }
  const driftSec = Math.abs(nowMs / 1000 - timestampSec)
  if (driftSec > TOLERANCE_SEC) {
    return { ok: false, reason: 'timestamp outside tolerance' }
  }

  // `whsec_` 접두어는 사람이 읽기 위한 것이고 키는 그 뒤의 base64다.
  const rawSecret = trimmedSecret.startsWith('whsec_')
    ? trimmedSecret.slice('whsec_'.length)
    : trimmedSecret
  const key = Buffer.from(rawSecret, 'base64')
  if (key.length === 0) {
    return { ok: false, reason: 'signing secret is not valid base64' }
  }

  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest('base64')

  for (const entry of headers.signature.split(' ')) {
    const separator = entry.indexOf(',')
    if (separator === -1) continue
    if (entry.slice(0, separator) !== 'v1') continue
    if (safeEqualBase64(entry.slice(separator + 1), expected)) {
      return { ok: true }
    }
  }

  return { ok: false, reason: 'no matching signature' }
}
