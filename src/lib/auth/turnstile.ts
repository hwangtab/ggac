/**
 * Cloudflare Turnstile 서버 측 검증 — 가입 남용 방지.
 *
 * 레이트리밋(시간당 10회/IP)만으로는 여러 IP로 나눠 도는 시도를 못 막는다.
 * Turnstile은 위젯이 사람임을 스스로 증명한 토큰을 넘기고, 여기서 그 토큰을
 * Cloudflare에 다시 물어 진짜인지 확인한다 — 토큰 자체는 클라이언트가 얼마든
 * 조작할 수 있으므로 서버 검증 없이는 의미가 없다.
 *
 * `TURNSTILE_SECRET_KEY`가 설정돼 있지 않으면 검증을 건너뛴다(통과). 이
 * 기능이 켜지기 전 배포·로컬 개발·이 기능을 아직 설정하지 않은 프리뷰
 * 환경에서 가입 자체가 막히면 안 된다 — 레이트리밋이 그 상태에서도 여전히
 * 1차 방어선이다. 건너뛴 사실은 감사 로그에 남긴다(설정 누락을 계속 모르고
 * 지나가면 안 되므로).
 */

import { logSecurityEvent } from '../../utils/security.ts'
import { createLogger } from '../../utils/logger.ts'

const log = createLogger('lib/auth/turnstile')

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileVerifyResult =
  | { ok: true; skipped: false }
  | { ok: true; skipped: true; reason?: 'not-configured' | 'lookup-failed' }
  | { ok: false; reason: 'missing-token' | 'rejected' }

/**
 * `secretKey`를 인자로 받는다 — 모듈 로드 시점이 아니라 호출 시점에
 * `process.env`를 읽어야 테스트에서 환경변수를 주입할 수 있고, 라우트 쪽도
 * "키가 있는데 왜 검증을 건너뛰나"를 추적하기 쉽다.
 */
export async function verifyTurnstileToken(
  token: unknown,
  remoteIp: string | undefined,
  secretKey: string | undefined = process.env.TURNSTILE_SECRET_KEY
): Promise<TurnstileVerifyResult> {
  if (!secretKey) {
    return { ok: true, skipped: true, reason: 'not-configured' }
  }

  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'missing-token' }
  }

  const body = new URLSearchParams({ secret: secretKey, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)

  let result: { success?: boolean; ['error-codes']?: string[] }
  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    })
    result = (await response.json()) as typeof result
  } catch (error) {
    // Cloudflare에 물어볼 수 없는 것과 사람이 아니라고 답한 것은 다르다 —
    // 후자만 거절한다. 조회 실패를 거절로 취급하면 Cloudflare 쪽 장애가
    // 그대로 가입 중단으로 번진다.
    log.error('Turnstile 검증 조회 실패(거절하지 않음)', {
      error: error instanceof Error ? error.message : String(error),
    })
    logSecurityEvent(
      'TURNSTILE_VERIFY_LOOKUP_FAILED',
      { message: error instanceof Error ? error.message : String(error) },
      'medium'
    )
    return { ok: true, skipped: true, reason: 'lookup-failed' }
  }

  if (result.success === true) {
    return { ok: true, skipped: false }
  }

  log.warn('Turnstile 검증 거절', { errorCodes: result['error-codes'] })
  return { ok: false, reason: 'rejected' }
}
