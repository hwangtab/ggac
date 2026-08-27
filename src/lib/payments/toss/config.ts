/**
 * 결제 설정 — 키 조회, 키 짝 검증, 킬스위치, 청구월 계산.
 *
 * 순수 판정 함수와 환경변수 조회를 한 파일에 두되, 순수 부분은 환경을 읽지
 * 않아 그대로 테스트된다(`scripts/testing/payments-config.test.mjs`).
 *
 * **시크릿 키는 이 모듈 밖으로 나가지 않는다.** 브라우저로 내려가는 코드는
 * `getPublicClientKey()`만 부른다.
 */

/** 결제 기능 전체를 끄는 스위치. 운영 전환 전 실수로 열리는 것을 막는다. */
const PAYMENT_MODE_ENV = 'NEXT_PUBLIC_PAYMENT_MODE'

export const DUES_MIN = 10_000
export const DUES_MAX = 50_000

/** 회원 가입 시 받아 둔 월 회비 범위. `member_profiles.monthly_fee`와 같은 값이다. */
export function assertDuesAmount(amount: unknown): asserts amount is number {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new Error(`회비 금액은 정수여야 합니다. (받은 값: ${String(amount)})`)
  }
  if (amount < DUES_MIN || amount > DUES_MAX) {
    throw new Error(
      `회비 금액은 ${DUES_MIN.toLocaleString()}원 이상 ${DUES_MAX.toLocaleString()}원 이하여야 합니다. (받은 값: ${amount})`
    )
  }
}

/**
 * 청구월. **KST 기준** 'YYYY-MM'.
 *
 * UTC로 계산하면 한국 시각 자정 직후(UTC 15시)에 도는 크론이 지난달을 다시
 * 청구한다. 서버가 어느 시간대에 있든 결과가 같도록 시간대를 명시해 포맷한다.
 */
export function currentBillingMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = parts.find(p => p.type === 'year')?.value
  const month = parts.find(p => p.type === 'month')?.value
  return `${year}-${month}`
}

export type KeyEnvironment = 'test' | 'live'

/** 키 접두사로 테스트·운영을 가른다. 값 자체는 절대 로그에 남기지 않는다. */
export function keyEnvironment(key: unknown): KeyEnvironment | null {
  if (typeof key !== 'string') return null
  if (key.startsWith('test_')) return 'test'
  if (key.startsWith('live_')) return 'live'
  return null
}

export class KeyMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyMismatchError'
  }
}

/**
 * 공개 키와 시크릿 키가 같은 환경인지 확인한다.
 *
 * 어긋나면 결제창은 정상적으로 뜨고 사용자는 카드까지 넣지만 **승인 단계에서
 * 통째로 실패한다**. 화면에는 원인이 드러나지 않아 찾는 데 오래 걸리므로,
 * 결제를 시작하기 전에 걸러 낸다.
 */
export function assertKeyPairConsistent(clientKey: unknown, secretKey: unknown): void {
  const clientEnv = keyEnvironment(clientKey)
  const secretEnv = keyEnvironment(secretKey)

  if (!clientEnv || !secretEnv) {
    throw new KeyMismatchError(
      '토스 결제 키가 설정되지 않았거나 형식이 올바르지 않습니다. 환경변수를 확인해 주세요.'
    )
  }
  if (clientEnv !== secretEnv) {
    throw new KeyMismatchError(
      `토스 결제 키의 환경이 어긋납니다. (공개 키: ${clientEnv}, 시크릿 키: ${secretEnv}) 같은 환경의 키 쌍을 사용해 주세요.`
    )
  }
}

/** 결제 기능이 켜져 있는가. `disabled`면 신규 결제를 전부 막는다. */
export function isPaymentEnabled(): boolean {
  return process.env[PAYMENT_MODE_ENV] === 'toss'
}

/**
 * 자동결제(빌링)는 **일반결제와 다른 키를 쓴다.**
 *
 * 토스는 연동 방식마다 키를 따로 발급한다. 일반결제(주문서형)는 `gck`/`gsk`,
 * 자동결제는 `ck`/`sk`(API 개별 연동 키)다. 실측으로 확인한 바로는 `gsk` 키로
 * 빌링 API를 부르면 `NOT_FOUND_MERCHANT`가 떨어진다 — 상점 자체를 못 찾는다.
 *
 * 그래서 자동결제 키가 없거나 잘못된 계열이면 **기능을 통째로 숨긴다.** 카드
 * 등록 화면까지 갔다가 발급 단계에서 실패하면, 회원은 등록된 줄 알고 다음
 * 달 청구를 기다리게 된다.
 */
export function isBillingEnabled(): boolean {
  const clientKey = process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY ?? ''
  const secretKey = process.env.TOSS_BILLING_SECRET_KEY ?? ''

  // 일반결제 계열(gck/gsk)이 잘못 들어오면 거부한다.
  if (/^(test|live)_g(c|s)k_/.test(clientKey) || /^(test|live)_g(c|s)k_/.test(secretKey)) {
    return false
  }

  try {
    assertKeyPairConsistent(clientKey, secretKey)
    return true
  } catch {
    return false
  }
}

/** 브라우저로 내려보내도 되는 자동결제 공개 키. */
export function getPublicBillingClientKey(): string {
  return process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY ?? ''
}

/**
 * 서버 전용 자동결제 설정. 시크릿 키가 들어 있으므로 응답에 실으면 안 된다.
 */
export function getBillingConfig(): { clientKey: string; secretKey: string } {
  if (!isBillingEnabled()) {
    throw new KeyMismatchError(
      '자동결제 키가 설정되지 않았습니다. 자동결제는 API 개별 연동 키(test_ck_/test_sk_)가 필요합니다.'
    )
  }
  return {
    clientKey: process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY ?? '',
    secretKey: process.env.TOSS_BILLING_SECRET_KEY ?? '',
  }
}

/** 브라우저로 내려보내도 되는 공개 키. */
export function getPublicClientKey(): string {
  return process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? ''
}

/**
 * 서버 전용 결제 설정. 시크릿 키가 들어 있으므로 **응답에 실으면 안 된다**.
 *
 * 키 짝이 어긋나면 여기서 던진다 — 결제를 시작하기 전에 실패하는 편이
 * 승인 단계에서 실패하는 것보다 훨씬 낫다.
 */
export function getServerPaymentConfig(): { clientKey: string; secretKey: string } {
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? ''
  const secretKey = process.env.TOSS_SECRET_KEY ?? ''
  assertKeyPairConsistent(clientKey, secretKey)
  return { clientKey, secretKey }
}
