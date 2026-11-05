/**
 * 인증 메일(가입 인증·비밀번호 재설정)의 **발송 예산** — 사이트 전체의 Resend 쿼터를 지키는 마지막 줄.
 *
 * ## 왜 필요한가
 * 가입(`/api/member-signup`)은 로그인 없이 호출할 수 있고, 입력한 **아무 주소**로 인증 메일을 보낸다.
 * 거기 걸린 제한은 IP당 시간당 10회뿐이라 한 IP가 하루 240통을 유발할 수 있다. Resend 무료 한도는 하루
 * 100통이고 **가입 인증·재설정·다이제스트·메일함 답장이 한 통을 나눠 쓴다.** 한도가 차면 조합원이 로그인도
 * 못 하고, 임의 주소로 보낸 메일의 반송이 쌓이면 발신 평판이 깎인다(`@test.local` 사고와 같은 모양).
 * 요청 단위 IP 제한은 "얼마나 자주 두드리나"를 막을 뿐 "하루에 총 몇 통이 나가나"를 막지 못한다.
 *
 * ## 무엇을 세는가
 * **요청이 아니라 실제로 발송하려는 메일**을 센다(Better Auth가 보내기로 결정한 뒤, Resend를 부르기 직전).
 * 두 겹이다.
 *  1. 수신자별 — 같은 주소로 하루 몇 통까지. 한 사람에게 메일 폭탄을 보내는 표적 공격을 끊는다.
 *     (수신자를 주소 그대로 저장하지 않고 해시한다 — 카운터 키에 개인정보를 남기지 않는다.)
 *  2. 전체 — 하루 몇 통까지. 임의의 서로 다른 주소로 퍼뜨리는 공격이 쿼터를 태우는 것을 끊는다.
 *
 * 수신자 한도에 걸린 요청은 전체 예산을 **소모하지 않는다** — 한 사람을 겨냥한 폭탄이 전체 예산을 비워
 * 다른 조합원의 재설정을 막으면 안 된다.
 *
 * ## 한도를 넘으면
 * 메일을 보내지 않고 조용히 넘어간다(API 응답은 그대로 200 — 메일이 안 갔다는 사실로 어떤 주소가 가입돼
 * 있는지 알려 주지 않는다). 보안 로그(`AUTH_EMAIL_BUDGET_EXCEEDED`)는 호출부가 남긴다. 정상 사용량은 하루 몇 통
 * 이하(최근 30일 신규 가입 0명)라 기본값에 걸릴 일이 없다.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test`의 타입 스트리핑 제약. 저장소(Upstash) 접근은 호출부가
 * 주입한다(`BudgetConsume`).
 */
import { createHash } from 'node:crypto'

export const DEFAULT_AUTH_MAIL_DAILY_LIMIT = 30
export const DEFAULT_AUTH_MAIL_PER_RECIPIENT_DAILY = 3
export const AUTH_MAIL_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000

/** 카운터를 하나 올리고 한도 안이면 true. 저장소 오류는 호출부가 정한 방식으로 처리해 불리언으로 돌려준다. */
export type BudgetConsume = (key: string, windowMs: number, max: number) => Promise<boolean>

export type BudgetVerdict = { allowed: true } | { allowed: false; scope: 'recipient' | 'global' }

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const text = raw?.trim()
  if (!text) return fallback
  const n = Number(text)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

export function authMailLimits(env: Record<string, string | undefined> = process.env) {
  return {
    global: nonNegativeInt(env.AUTH_MAIL_DAILY_LIMIT, DEFAULT_AUTH_MAIL_DAILY_LIMIT),
    perRecipient: nonNegativeInt(
      env.AUTH_MAIL_PER_RECIPIENT_DAILY,
      DEFAULT_AUTH_MAIL_PER_RECIPIENT_DAILY
    ),
  }
}

/** 카운터 키에 주소를 그대로 남기지 않는다. */
export function recipientBudgetKey(to: string): string {
  const digest = createHash('sha256').update(to.trim().toLowerCase()).digest('hex').slice(0, 32)
  return `auth_mail:rcpt:${digest}`
}

export const GLOBAL_BUDGET_KEY = 'auth_mail:global'

/**
 * 이 메일을 보내도 되는가. 수신자 예산을 먼저 소모하고, 통과했을 때만 전체 예산을 소모한다.
 * 한도 0은 "인증 메일 전면 차단"이다(기본값으로 바꾸지 않는다 — 운영자가 막으려고 0을 넣은 것이다).
 */
export async function checkAuthMailBudget(
  consume: BudgetConsume,
  to: string,
  env: Record<string, string | undefined> = process.env
): Promise<BudgetVerdict> {
  const limits = authMailLimits(env)

  if (limits.perRecipient === 0 || limits.global === 0) {
    return { allowed: false, scope: limits.perRecipient === 0 ? 'recipient' : 'global' }
  }

  const recipientOk = await consume(
    recipientBudgetKey(to),
    AUTH_MAIL_BUDGET_WINDOW_MS,
    limits.perRecipient
  )
  if (!recipientOk) return { allowed: false, scope: 'recipient' }

  const globalOk = await consume(GLOBAL_BUDGET_KEY, AUTH_MAIL_BUDGET_WINDOW_MS, limits.global)
  if (!globalOk) return { allowed: false, scope: 'global' }

  return { allowed: true }
}
