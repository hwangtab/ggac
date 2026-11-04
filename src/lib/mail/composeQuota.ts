/**
 * 메일함 새 메일 발송의 킬스위치와 일일 상한 — 순수 함수(로컬 import 없음).
 *
 * Resend 무료 플랜은 하루 약 100통이고 **수신도 같은 쿼터를 먹는다**(`inbound/resend/route.ts`).
 * 가입 인증·재설정·지원사업 다이제스트가 같은 쿼터를 쓰므로, 메일함 발신이 그 몫을 굶기지 않게
 * 두 단계로 막는다.
 *  1. 메일함 발신 상한: 새 메일 수신자 수 + 답장 수의 24시간 합.
 *  2. 총량 가드: 위 값 + 24시간 수신 건수. 인증·다이제스트 몫(기본 30통)을 남긴다.
 *
 * 인증 메일 발송은 원장이 없어 셀 수 없다 — 이 값들은 하한 추정이다. 실제 사용량은 Resend 대시보드가 정본이다.
 */

export const DEFAULT_DAILY_OUTBOUND_LIMIT = 20
export const DEFAULT_DAILY_TOTAL_GUARD = 70

/** 정확히 'true'일 때만 켜진다. 비어 있거나 다른 값이면 작성·발송이 막힌다(안전한 기본값). */
export function isComposeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MAILBOX_COMPOSE_ENABLED?.trim() === 'true'
}

/**
 * 0 이상의 정수만 받는다. **0은 "메일함 발신 전면 차단"이다** — 운영자가 발신을 멈추려고 0을 넣는 것이
 * 가장 자연스러운 동작이라, 0을 기본값으로 바꿔 버리면 오히려 20통이 나간다. 비었거나 정수가 아닌
 * 값은 기본값이다.
 */
function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const text = raw?.trim()
  if (!text) return fallback
  const n = Number(text)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

export function dailyOutboundLimit(env: Record<string, string | undefined> = process.env): number {
  return nonNegativeInt(env.MAILBOX_DAILY_OUTBOUND_LIMIT, DEFAULT_DAILY_OUTBOUND_LIMIT)
}

export function dailyTotalGuard(env: Record<string, string | undefined> = process.env): number {
  return nonNegativeInt(env.MAILBOX_DAILY_TOTAL_GUARD, DEFAULT_DAILY_TOTAL_GUARD)
}

export type QuotaVerdict =
  | { allowed: true; pressure: boolean }
  | { allowed: false; reason: 'outbound_limit' | 'total_guard' }

/**
 * @param outboundIncludingThis 이번 요청의 행을 이미 포함한 24시간 발신 수신자 수.
 *   행을 먼저 쓰고 센다 — 동시 요청이 서로를 보게 해서 둘 다 통과하는 경쟁을 막는다.
 * @param inbound24h 24시간 수신 건수.
 */
export function evaluateQuota(
  outboundIncludingThis: number,
  inbound24h: number,
  limits: { outbound: number; total: number }
): QuotaVerdict {
  if (outboundIncludingThis > limits.outbound) return { allowed: false, reason: 'outbound_limit' }
  if (outboundIncludingThis + inbound24h > limits.total) {
    return { allowed: false, reason: 'total_guard' }
  }
  const pressure =
    outboundIncludingThis >= limits.outbound * 0.8 ||
    outboundIncludingThis + inbound24h >= limits.total * 0.8
  return { allowed: true, pressure }
}
