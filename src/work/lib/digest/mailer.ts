/**
 * 다이제스트 메일 발송 수단 — 원본 kosmart-work `lib/digest/resend.ts`(Resend REST, 상태 코드 분류)를 옮기고
 * **주입할 수 있게** 했다. 순수 모듈(로컬 import 없음) — `node --test`가 직접 읽는다.
 *
 * - `resendMailer(apiKey)`  실제 발송(fetch → api.resend.com). 던지지 않고 결과를 분류해 돌려준다.
 * - `captureMailer(sink)`  보내지 않고 sink에 쌓는다(시험).
 * - `logMailer()`          보내지 않고 건수만 남긴다(E2E·로컬). 받는 주소·본문은 로그에 남기지 않는다.
 * - `digestMailerFromEnv` `BOARD_WORK_DIGEST_TRANSPORT`가 'log'면 logMailer(운영 배포 VERCEL_ENV=production에서는 무시),
 *   아니면 `RESEND_API_KEY`가 있을 때만 resendMailer, 없으면 null(= 다이제스트 건너뜀).
 */

export type DigestMail = { to: string; subject: string; html: string; text: string }

export type MailResult =
  | { ok: true }
  | {
      ok: false
      /**
       * rate_limited: 429(이번 실행에서는 더 보내지 않는다) · rejected: 400/422(받는 주소·내용이 영구히 잘못됨) ·
       * unauthorized: 401/403(키·발신 도메인 오류 — 누구에게 보내도 실패) · send_failed: 그 밖(재시도 대상)
       */
      reason: 'send_failed' | 'rate_limited' | 'rejected' | 'unauthorized'
    }

export type DigestMailer = (mail: DigestMail) => Promise<MailResult>

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
/** ggac 발신자(src/lib/mail/send.ts와 같은 값) */
export const DIGEST_FROM = '경기아트콜렉티브 <noreply@ggac.kr>'
/** Resend 응답을 기다리는 최대 시간. 무한정 기다리면 크론 함수가 시간 초과로 죽어 뒤 사용자까지 막힌다 */
const TIMEOUT_MS = 10_000

export function classifyResendStatus(status: number): MailResult {
  if (status >= 200 && status < 300) return { ok: true }
  if (status === 429) return { ok: false, reason: 'rate_limited' }
  if (status === 400 || status === 422) return { ok: false, reason: 'rejected' }
  if (status === 401 || status === 403) return { ok: false, reason: 'unauthorized' }
  return { ok: false, reason: 'send_failed' }
}

export function resendMailer(
  apiKey: string,
  opts: { from?: string; replyTo?: string | null; fetchImpl?: typeof fetch } = {}
): DigestMailer {
  const doFetch = opts.fetchImpl ?? fetch
  return async mail => {
    try {
      const res = await doFetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          from: opts.from ?? DIGEST_FROM,
          to: [mail.to],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          ...(opts.replyTo ? { reply_to: [opts.replyTo] } : {}),
        }),
      })
      const result = classifyResendStatus(res.status)
      if (!result.ok) {
        // 본문에 API 키가 들어가지 않는다 — 상태 코드만 남긴다
        console.error('[digest] Resend 응답 오류:', res.status)
      }
      return result
    } catch (err) {
      console.error('[digest] Resend 호출 실패:', err instanceof Error ? err.name : 'unknown')
      return { ok: false, reason: 'send_failed' }
    }
  }
}

export function captureMailer(sink: DigestMail[]): DigestMailer {
  return async mail => {
    sink.push(mail)
    return { ok: true }
  }
}

export function logMailer(): DigestMailer {
  return async () => {
    console.info('[digest] 발송 생략(BOARD_WORK_DIGEST_TRANSPORT=log) — 메일 1통')
    return { ok: true }
  }
}

export function digestMailerFromEnv(env: Record<string, string | undefined>): DigestMailer | null {
  const mode = env.BOARD_WORK_DIGEST_TRANSPORT?.trim()
  if (mode === 'log' && env.VERCEL_ENV !== 'production') return logMailer()
  const key = env.RESEND_API_KEY?.trim()
  if (!key) return null
  return resendMailer(key)
}
