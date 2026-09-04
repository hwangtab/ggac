/**
 * 결제 실패 코드 → 사람이 읽는 안내.
 *
 * 실패는 두 경로로 들어온다. 토스가 `/tickets/fail`로 되돌려 보내는 경우와,
 * `/tickets/success`에서 승인 확정이 실패하는 경우다. 두 화면이 같은 문장을
 * 쓰도록 매핑을 여기 한 곳에 둔다.
 */

/** 안내 문구를 따로 갖고 있는 코드들. 그 밖의 코드는 서버 메시지를 그대로 쓴다. */
export const KNOWN_FAILURE_CODES = [
  'PAY_PROCESS_CANCELED',
  'PAY_PROCESS_ABORTED',
  'REJECT_CARD_COMPANY',
  'REJECT_CARD_PAYMENT',
  'INVALID_CARD_EXPIRATION',
] as const

export type KnownFailureCode = (typeof KNOWN_FAILURE_CODES)[number]

function isKnownCode(code: string): code is KnownFailureCode {
  return (KNOWN_FAILURE_CODES as readonly string[]).includes(code)
}

/**
 * 코드가 알려진 것이면 번역된 안내를, 아니면 서버·결제사 메시지를, 그것도
 * 없으면 기본 문장을 돌려준다.
 *
 * @param translate `tickets` 네임스페이스의 번역 함수.
 */
export function resolvePaymentFailureMessage(
  translate: (key: string) => string,
  code: string | null | undefined,
  serverMessage?: string | null
): string {
  if (code && isKnownCode(code)) return translate(`fail.codes.${code}`)
  const fallback = (serverMessage ?? '').trim()
  return fallback || translate('fail.defaultMessage')
}
