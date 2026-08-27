/**
 * 토스페이먼츠 프로토콜의 **순수 규칙**만 담는다.
 *
 * 네트워크를 타지 않고, 환경변수를 읽지 않고, DB를 모른다. 그래서
 * `scripts/testing/payments-toss-protocol.test.mjs`가 요청 스코프 없이
 * 그대로 검증할 수 있다(`src/db/queries/*`·`src/middleware/profile.ts`와
 * 같은 관례).
 *
 * 여기 규칙이 깨지면 조용한 버그가 아니라 **돈이 틀어진다** — 그래서 전부
 * 테스트로 고정돼 있다.
 */

import { createHash, randomUUID } from 'node:crypto'

/**
 * 토스 API의 Basic 인증 헤더.
 *
 * 토스는 시크릿 키를 사용자 ID로 쓰고 비밀번호는 쓰지 않는다. 비밀번호가
 * 없다는 걸 알리려고 **키 뒤에 콜론을 붙여** base64로 인코딩한다. 콜론을
 * 빠뜨리면 전 API가 `INCORRECT_BASIC_AUTH_FORMAT`으로 떨어지므로 토스 문서도
 * 이 지점을 따로 경고한다.
 */
export function buildAuthHeader(secretKey: string): string {
  if (typeof secretKey !== 'string' || secretKey.trim() === '') {
    throw new Error('토스 시크릿 키가 설정되지 않았습니다.')
  }
  return 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64')
}

/** 주문번호에 붙는 용도 접두사. 나중에 원장을 눈으로 훑을 때 구분된다. */
export type OrderKind = 'dues' | 'ticket'

/**
 * 토스 주문번호.
 *
 * 규격은 **영문 대소문자·숫자·`-`·`_`로 이루어진 6~64자**다. UUID의 하이픈은
 * 허용 문자에 들어가지만, 원장을 훑을 때 접두사와 구분되도록 떼어낸다.
 * 결과는 `dues_` + 32자 = 37자로 규격 안에 넉넉히 들어온다.
 */
export function generateOrderId(kind: OrderKind): string {
  return `${kind}_${randomUUID().replace(/-/g, '')}`
}

/** 금액 대조 실패. 조작 시도일 수 있으므로 두 값을 모두 보존한다. */
export class AmountMismatchError extends Error {
  expected: number
  received: unknown

  constructor(expected: number, received: unknown) {
    super(`결제 금액이 일치하지 않습니다. (기대 ${expected}, 수신 ${String(received)})`)
    this.name = 'AmountMismatchError'
    this.expected = expected
    this.received = received
  }
}

/**
 * 원 단위 정수로만 받는다.
 *
 * `Number('')`가 `0`이고 `Number(null)`도 `0`이라, 값을 그대로 `Number()`에
 * 넘기면 **빈 값이 0원으로 둔갑**한다. 그래서 숫자 모양을 정규식으로 먼저
 * 확인한 뒤에만 변환한다.
 */
function toWon(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * 우리가 저장해 둔 금액과 결제창이 돌려준 금액을 대조한다.
 *
 * 결제 요청은 브라우저에서 일어나므로 사용자가 콘솔로 금액을 바꿀 수 있다.
 * 이 대조를 건너뛰고 돌아온 값을 그대로 승인에 넘기면 **조작된 금액으로 결제가
 * 완료된다** — 토스 문서가 가장 강하게 경고하는 지점이다. 승인 API에는 이
 * 함수를 통과한 뒤에도 **수신값이 아니라 저장값**을 넘긴다.
 */
export function assertAmountMatches(expected: number, received: unknown): void {
  const parsed = toWon(received)
  if (parsed === null || parsed !== expected) {
    throw new AmountMismatchError(expected, received)
  }
}

/** 멱등키를 붙일 작업. 승인과 취소가 키를 공유하면 서로의 응답을 되돌려받는다. */
export type IdempotentAction = 'confirm' | 'cancel' | 'billing-issue' | 'billing-charge'

/**
 * 멱등키.
 *
 * 같은 주문의 같은 작업이면 **항상 같은 값**이어야 한다 — 재시도할 때 키가
 * 바뀌면 멱등성이 깨져 이중 결제가 난다. 반대로 작업이 다르면 반드시 달라야
 * 한다. 토스는 (멱등키 + API 키 + 주소 + 메서드)로 판정하고 키를 15일 보관하며
 * 300자까지 받는데, sha256 hex는 64자라 넉넉히 들어온다.
 */
export function buildIdempotencyKey(orderId: string, action: IdempotentAction): string {
  return createHash('sha256').update(`${action}:${orderId}`).digest('hex')
}

/**
 * 결제창에 넘기는 구매자 식별값.
 *
 * 토스 문서는 이메일·전화번호·순번처럼 **유추 가능한 값을 쓰지 말라**고
 * 경고한다. 자동결제에서 이 값은 사실상 두 번째 비밀번호이기 때문이다 —
 * 빌링키가 유출돼도 짝이 되는 이 값을 모르면 결제가 되지 않는다.
 *
 * 그래서 회원 id를 그대로 쓰지 않고 해시해서 쓴다. 같은 회원이면 항상 같은
 * 값이어야 빌링키와의 짝이 유지된다. 규격은 2~50자에 허용 문자만이고 특수문자를
 * 최소 하나 포함해야 하므로, 접두사 `m_`를 붙여 그 조건을 함께 만족시킨다.
 */
export function buildCustomerKey(userId: string): string {
  const digest = createHash('sha256').update(`ggac:customer:${userId}`).digest('hex')
  return `m_${digest.slice(0, 40)}`
}
