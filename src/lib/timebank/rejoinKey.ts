/**
 * 재가입 승계 키 (스펙 §3 `timebank_withdrawn_keys`, §9.3). **서버 전용** —
 * `node:crypto`를 쓰고 비밀값을 다루므로 클라이언트 컴포넌트에서 임포트하지 않는다.
 *
 * 키 = HMAC-SHA256(파생 키, `'email:' | 'phone:'` + 정규화값)의 hex.
 * 파생 키 = HMAC-SHA256(`TIMEBANK_REJOIN_SECRET`, `'ggac-timebank-rejoin-v1'`).
 * 원문(이메일·전화)은 어디에도 남기지 않는다. 비밀값을 바꾸면 기존 키는 전부
 * 일치하지 않게 된다(승계가 끊긴다) — 회전할 때는 이 점을 감안한다.
 *
 * `node --test`가 직접 import하므로 임포트는 `node:` 내장뿐이다.
 */

import { createHmac } from 'node:crypto'

const DERIVATION_LABEL = 'ggac-timebank-rejoin-v1'

/** trim + lowercase. 비면 null. */
export function normalizeRejoinEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null
  const v = email.trim().toLowerCase()
  return v === '' ? null : v
}

/** 숫자만 남긴다(`010-1234-5678` = `01012345678`). 숫자가 없으면 null. */
export function normalizeRejoinPhone(phone: string | null | undefined): string | null {
  if (typeof phone !== 'string') return null
  let v = phone.replace(/\D+/g, '')
  // 국내 번호는 0으로 시작하므로 82로 시작하는 9자리 이상은 국가번호 표기다. 국가번호 82로 적은 국내 번호를 0으로 시작하는 국내 형식으로 맞춘다. 프로필 전화칸은
  // 자유 형식(`+82 10-…`도 받는다)이라 맞추지 않으면 같은 번호가 다른 키가 되어
  // 재가입 확인을 빠져나간다. `+82 010-…`처럼 0을 남겨 적은 경우도 같다.
  if (v.startsWith('82') && v.length >= 9) v = '0' + v.slice(2).replace(/^0/, '')
  return v === '' ? null : v
}

function derivedKey(secret: string): Buffer {
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error('timebank rejoin key: secret is required')
  }
  return createHmac('sha256', secret).update(DERIVATION_LABEL).digest()
}

/**
 * 이메일·전화 각각 한 키(있는 것만, 이메일 먼저). 둘 다 없으면 빈 배열.
 * `secret`이 비면 던진다 — 빈 비밀값의 HMAC은 누구나 다시 만들 수 있다.
 */
export function rejoinKeysFor(
  input: { email: string | null; phone: string | null },
  secret: string
): string[] {
  const key = derivedKey(secret)
  const parts: string[] = []
  const email = normalizeRejoinEmail(input.email)
  if (email) parts.push(`email:${email}`)
  const phone = normalizeRejoinPhone(input.phone)
  if (phone) parts.push(`phone:${phone}`)
  return parts.map(p => createHmac('sha256', key).update(p).digest('hex'))
}

/** 전용 비밀값의 최소 길이. `openssl rand -base64 48`은 64자다. */
export const REJOIN_SECRET_MIN_LENGTH = 32

/**
 * `TIMEBANK_REJOIN_SECRET` — 재가입 키 전용 비밀값. **교체하지 않는다.**
 *
 * 예전에는 `BETTER_AUTH_SECRET`을 썼다. 그 값은 세션 보안 사고 때 급히 바꿔야
 * 하는 값인데, 바꾸는 순간 저장된 `timebank_withdrawn_keys`가 전부 안 맞게 되어
 * 음수 잔액 탈퇴자가 재가입하면 가입 크레딧을 새로 받는다(원문을 저장하지 않으니
 * 다시 계산할 수도 없다). 그래서 회전 주기가 다른 두 값을 떼어 냈다. 폴백은 두지
 * 않는다 — `BETTER_AUTH_SECRET`으로 떨어지면 같은 함정이 그대로 돌아온다.
 *
 * 없거나 짧으면 던진다. 조용히 건너뛰면 탈퇴·재가입 승계가 무력화된다(스펙 §9.3).
 */
export function rejoinSecretFromEnv(): string {
  const secret = process.env.TIMEBANK_REJOIN_SECRET
  if (typeof secret !== 'string' || secret.trim().length < REJOIN_SECRET_MIN_LENGTH) {
    throw new Error(
      `TIMEBANK_REJOIN_SECRET is required for timebank rejoin keys (at least ${REJOIN_SECRET_MIN_LENGTH} characters)`
    )
  }
  return secret
}
