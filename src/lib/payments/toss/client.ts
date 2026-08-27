/**
 * 토스페이먼츠 API 호출 계층.
 *
 * **토스와 통신하는 유일한 지점이다.** 라우트·크론·웹훅이 `fetch`로 토스를
 * 직접 부르지 않는다 — 그렇게 흩어지면 멱등키를 붙이는 걸 한 군데서 빠뜨려도
 * 아무도 모른다.
 *
 * 시크릿 키를 환경변수에서 직접 읽지 않고 **주입받는다**. 그래야 이 모듈이
 * 환경 없이 테스트되고(`scripts/testing/payments-toss-client.test.mjs`),
 * 나중에 자동결제 MID가 추가돼 키가 둘로 갈릴 때 호출부가 고를 수 있다.
 */

import { buildAuthHeader, buildIdempotencyKey, type IdempotentAction } from './protocol.ts'

const API_BASE = 'https://api.tosspayments.com'

/**
 * 자동결제 승인은 최대 60초까지 걸린다고 토스 문서가 명시한다. 일반 승인은
 * 그보다 짧지만, 타임아웃이 짧아서 끊기면 "승인됐는지 모르는" 최악의 상태가
 * 되므로 넉넉하게 잡는다.
 */
const DEFAULT_TIMEOUT_MS = 60_000

export interface TossDeps {
  secretKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** 토스가 **명확히 거절**한 경우. 코드로 분기할 수 있다. */
export class TossApiError extends Error {
  code: string
  status: number
  body: unknown

  constructor(code: string, message: string, status: number, body: unknown) {
    super(message)
    this.name = 'TossApiError'
    this.code = code
    this.status = status
    this.body = body
  }
}

/**
 * **판단할 수 없는** 경우 — 네트워크 오류, 타임아웃, 5xx, 인증 실패.
 *
 * 이걸 "결제 없음"이나 "결제 실패"로 뭉개면 안 된다. 실제로 승인된 결제를
 * 미결제로 기록하고 환불 없이 취소하는 사고가 여기서 나온다. 호출부는 이
 * 오류를 받으면 **아무 판단도 하지 말고 다음 대사 주기로 미뤄야** 한다.
 */
export class TossLookupError extends Error {
  cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'TossLookupError'
    this.cause = cause
  }
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  body?: unknown
  idempotency?: { orderId: string; action: IdempotentAction }
}

async function request(options: RequestOptions, deps: TossDeps): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(deps.secretKey),
    'Content-Type': 'application/json',
  }
  // 멱등키는 POST에만 의미가 있다 — GET에 붙이면 토스가 무시한다.
  if (options.idempotency) {
    headers['Idempotency-Key'] = buildIdempotencyKey(
      options.idempotency.orderId,
      options.idempotency.action
    )
  }

  try {
    return await fetchImpl(`${API_BASE}${options.path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    // 요청이 토스에 닿았는지조차 알 수 없다.
    throw new TossLookupError('토스 API 요청이 완료되지 않았습니다.', error)
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch (error) {
    throw new TossLookupError('토스 응답을 해석할 수 없습니다.', error)
  }
}

/**
 * 5xx와 인증 오류는 "거절"이 아니라 "판단 불가"다. 4xx 중에서도 우리 요청이
 * 잘못됐다는 응답만 `TossApiError`로 올린다.
 */
function isUndecidable(status: number): boolean {
  return status >= 500 || status === 401 || status === 403 || status === 429
}

async function throwForStatus(response: Response, context: string): Promise<never> {
  const body = await readJson(response).catch(() => ({}) as Record<string, unknown>)
  const code = typeof body.code === 'string' ? body.code : 'UNKNOWN'
  const message = typeof body.message === 'string' ? body.message : `${context} 실패`

  if (isUndecidable(response.status)) {
    throw new TossLookupError(`${context}: ${code} ${message}`, body)
  }
  throw new TossApiError(code, message, response.status, body)
}

/**
 * 결제 승인.
 *
 * `amount`에는 **우리 원장에 저장된 금액**을 넣는다. 결제창이 돌려준 값을
 * 그대로 넘기면 브라우저에서 조작된 금액이 그대로 승인된다 — 대조는
 * `assertAmountMatches`가 하고, 여기 오는 값은 이미 대조를 통과한 저장값이다.
 */
export async function confirmPayment(
  input: { paymentKey: string; orderId: string; amount: number },
  deps: TossDeps
): Promise<Record<string, unknown>> {
  const response = await request(
    {
      method: 'POST',
      path: '/v1/payments/confirm',
      body: { paymentKey: input.paymentKey, orderId: input.orderId, amount: input.amount },
      idempotency: { orderId: input.orderId, action: 'confirm' },
    },
    deps
  )

  if (!response.ok) await throwForStatus(response, '결제 승인')
  return readJson(response)
}

/**
 * 결제 조회.
 *
 * @returns 결제가 **없다는 답을 받았을 때만** `null`. 그 밖의 실패는
 *   `TossLookupError`로 던진다 — 호출부가 "없음"과 "모름"을 구분해야 한다.
 */
export async function lookupPayment(
  paymentKey: string,
  deps: TossDeps
): Promise<Record<string, unknown> | null> {
  const response = await request(
    { method: 'GET', path: `/v1/payments/${encodeURIComponent(paymentKey)}` },
    deps
  )

  if (response.ok) return readJson(response)

  const body = await readJson(response).catch(() => ({}) as Record<string, unknown>)
  const code = typeof body.code === 'string' ? body.code : 'UNKNOWN'

  if (response.status === 404 && code === 'NOT_FOUND_PAYMENT') return null

  throw new TossLookupError(`결제 조회 실패: ${code}`, body)
}

/**
 * 결제 취소.
 *
 * `cancelAmount`를 넘기지 않으면 토스가 **전액 취소**로 처리한다. 0을 보내면
 * 안 되므로 값이 있을 때만 싣는다.
 *
 * 이미 취소된 결제라는 응답은 오류가 아니라 성공으로 다룬다 — 재시도나 웹훅
 * 중복으로 같은 취소가 두 번 나가는 건 정상이고, 여기서 던지면 환불이 끝났는데
 * 화면에는 실패가 뜬다.
 */
export async function cancelPayment(
  paymentKey: string,
  input: { cancelReason: string; orderId: string; cancelAmount?: number },
  deps: TossDeps
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { cancelReason: input.cancelReason }
  if (typeof input.cancelAmount === 'number') body.cancelAmount = input.cancelAmount

  const response = await request(
    {
      method: 'POST',
      path: `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
      body,
      idempotency: { orderId: input.orderId, action: 'cancel' },
    },
    deps
  )

  if (response.ok) return readJson(response)

  const errorBody = await readJson(response).catch(() => ({}) as Record<string, unknown>)
  if (errorBody.code === 'ALREADY_CANCELED_PAYMENT') {
    return { ...errorBody, alreadyCanceled: true }
  }

  const code = typeof errorBody.code === 'string' ? errorBody.code : 'UNKNOWN'
  const message = typeof errorBody.message === 'string' ? errorBody.message : '결제 취소 실패'
  if (isUndecidable(response.status)) {
    throw new TossLookupError(`결제 취소: ${code} ${message}`, errorBody)
  }
  throw new TossApiError(code, message, response.status, errorBody)
}

// ------------------------------------------------------------ 자동결제(빌링)

/**
 * 카드 등록 인증키(`authKey`)를 **빌링키**로 바꾼다.
 *
 * 결제창이 성공 주소로 돌려보낸 `authKey`는 일회성이다. 이 호출로 빌링키를
 * 받는 순간부터 카드번호 없이 결제를 걸 수 있게 된다.
 *
 * ⚠️ 받은 빌링키는 **다시 조회할 수 없다**(토스 문서). 저장에 실패하면 회원이
 * 카드를 다시 등록하는 수밖에 없으므로, 호출부는 저장이 끝난 뒤에 성공을
 * 알려야 한다.
 */
export async function issueBillingKey(
  input: { authKey: string; customerKey: string },
  deps: TossDeps
): Promise<Record<string, unknown>> {
  const response = await request(
    {
      method: 'POST',
      path: '/v1/billing/authorizations/issue',
      body: { authKey: input.authKey, customerKey: input.customerKey },
    },
    deps
  )

  if (!response.ok) await throwForStatus(response, '빌링키 발급')
  return readJson(response)
}

/**
 * 빌링키로 결제를 건다. **서버 전용 경로다** — 결제창도, 성공 주소도, 승인
 * 확정도 거치지 않고 이 한 번의 호출로 결제가 끝난다.
 *
 * 그래서 토스는 자동결제에 **완료 웹훅을 보내지 않는다**. 응답을 받은 그
 * 자리에서 기록해야 하고, 응답을 못 받은 건은 대사로 맞춰야 한다.
 *
 * `customerKey`가 빌링키와 짝이 맞지 않으면 `NOT_MATCHES_CUSTOMER_KEY`로
 * 거절된다 — 빌링키만으로는 결제할 수 없다는 뜻이라, 이 값도 비밀에 준해
 * 다뤄야 한다.
 */
export async function chargeBilling(
  billingKey: string,
  input: {
    customerKey: string
    amount: number
    orderId: string
    orderName: string
    customerEmail?: string | null
    customerName?: string | null
  },
  deps: TossDeps
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    customerKey: input.customerKey,
    amount: input.amount,
    orderId: input.orderId,
    orderName: input.orderName,
  }
  if (input.customerEmail) body.customerEmail = input.customerEmail
  if (input.customerName) body.customerName = input.customerName

  const response = await request(
    {
      method: 'POST',
      path: `/v1/billing/${encodeURIComponent(billingKey)}`,
      body,
      idempotency: { orderId: input.orderId, action: 'billing-charge' },
    },
    deps
  )

  if (!response.ok) await throwForStatus(response, '자동결제 승인')
  return readJson(response)
}

/**
 * 빌링키를 토스에서 삭제한다. 해지할 때 우리 쪽 비활성화와 함께 부른다.
 *
 * 응답 본문을 파싱하지 않는다 — 레퍼런스는 "빈 body에 200", 가이드는
 * `{billingKey}`라고 적어 서로 다르다. 상태 코드만 본다.
 *
 * 이미 없는 키라는 응답도 성공으로 다룬다. 해지 재시도에서 던지면 회원
 * 화면에 "해지 실패"가 뜨는데, 실제로는 해지된 상태다.
 */
export async function deleteBillingKey(billingKey: string, deps: TossDeps): Promise<boolean> {
  const response = await request(
    { method: 'DELETE', path: `/v1/billing/${encodeURIComponent(billingKey)}` },
    deps
  )

  if (response.ok) return true

  const body = await readJson(response).catch(() => ({}) as Record<string, unknown>)
  const code = typeof body.code === 'string' ? body.code : 'UNKNOWN'
  if (code === 'NOT_FOUND_BILLING_KEY' || code === 'NOT_FOUND_BILLING') return true

  const message = typeof body.message === 'string' ? body.message : '빌링키 삭제 실패'
  if (isUndecidable(response.status)) {
    throw new TossLookupError(`빌링키 삭제: ${code} ${message}`, body)
  }
  throw new TossApiError(code, message, response.status, body)
}
