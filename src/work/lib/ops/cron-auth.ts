import { timingSafeEqual } from 'node:crypto'

/**
 * 업무툴 크론 인증(순수) — 원본 kosmart-work `lib/cron.ts` isCronAuthorized·verifyCronRequest.
 * ggac의 다른 내부 크론(`/api/internal/market/close-auctions` 등)과 같은 규칙: `Authorization: Bearer $CRON_SECRET`를
 * **타이밍 안전 비교**하고, 시크릿이 설정돼 있지 않으면 **닫는다**(fail-closed). Vercel 크론은 이 헤더를 고정으로 붙인다.
 * `node --test`가 직접 읽는다.
 *
 * 원본은 시크릿 미설정을 503으로 구분했다. ggac 관례(다른 내부 크론 전부 401)를 따라 401로 닫는다 — 응답으로
 * "이 배포에 시크릿이 없다"를 알리지 않는다. 미설정은 `isCronSecretConfigured`로 따로 보고 실패 알림을 남긴다.
 */
export function isCronSecretConfigured(secret: string | undefined | null): boolean {
  return typeof secret === 'string' && secret.length > 0
}

/**
 * Bearer 토큰을 하나 이상의 시크릿과 대조한다. 시크릿이 여럿이면 하나라도 맞으면 통과.
 * 비교는 **바이트 길이**로 선검사한다 — 글자 수가 같아도 멀티바이트면 바이트 수가 달라
 * `timingSafeEqual`이 던지고 인증 전 500이 되기 때문이다. 어떤 입력에도 던지지 않는다.
 */
export function isCronAuthorized(
  authorization: string | null | undefined,
  ...secrets: Array<string | undefined | null | Array<string | undefined | null>>
): boolean {
  const configured = secrets.flat().filter((v): v is string => isCronSecretConfigured(v))
  if (configured.length === 0) return false
  try {
    const header = typeof authorization === 'string' ? authorization : ''
    const provided = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
    let ok = false
    for (const secret of configured) {
      const b = Buffer.from(secret)
      if (provided.length === b.length && timingSafeEqual(provided, b)) ok = true
    }
    return ok
  } catch {
    return false
  }
}
