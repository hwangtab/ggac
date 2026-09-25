/**
 * 조합비 결제 도메인 규칙.
 *
 * "이번 달 회비를 결제할 수 있는가, 얼마인가"의 판단만 담는다 — DB도 토스도
 * 모른다. 라우트가 이 판단을 인라인으로 하면 요청 스코프 없이는 테스트할 수
 * 없게 되고, 결국 결제 금액을 정하는 규칙이 검증되지 않은 채 남는다.
 */

import { assertDuesAmount, currentBillingMonth } from './toss/config.ts'

export type DuesPlanReason = 'already-paid' | 'no-fee-set' | 'invalid-fee'

export class DuesPlanError extends Error {
  reason: DuesPlanReason

  constructor(reason: DuesPlanReason, message: string) {
    super(message)
    this.name = 'DuesPlanError'
    this.reason = reason
  }
}

export interface DuesPlan {
  amount: number
  orderName: string
}

interface PlanInput {
  /** `member_profiles` 행. `monthly_fee`만 읽는다. */
  profile: { monthly_fee?: number | null } | null
  /** 'YYYY-MM' */
  billingMonth: string
  /** 이미 만들어진 청구 행. 없으면 null. */
  existingDues: { status?: string | null; amount?: number | null } | null
}

/** '2026-09' → '2026년 9월'. 카드 명세서에 찍히므로 사람이 읽는 형태로 만든다. */
function formatBillingMonth(billingMonth: string): string {
  const [year, month] = billingMonth.split('-')
  return `${year}년 ${Number(month)}월`
}

/**
 * 결제 계획을 세운다.
 *
 * 금액의 우선순위가 중요하다: **이미 만들어진 청구 행의 금액이 우선**이고,
 * 없을 때만 회원의 현재 회비 설정을 쓴다. 청구서를 보낸 뒤 회원이 회비를
 * 바꿔도 그 달 청구액은 고지한 값이어야 하기 때문이다.
 */
export function planDuesPayment(input: PlanInput): DuesPlan {
  if (input.existingDues?.status === 'paid') {
    throw new DuesPlanError(
      'already-paid',
      `${formatBillingMonth(input.billingMonth)} 조합비는 이미 납부하셨습니다.`
    )
  }

  const amount =
    typeof input.existingDues?.amount === 'number'
      ? input.existingDues.amount
      : input.profile?.monthly_fee

  if (typeof amount !== 'number') {
    throw new DuesPlanError(
      'no-fee-set',
      '월 회비 금액이 설정되어 있지 않습니다. 사무국으로 문의해 주세요.'
    )
  }

  try {
    assertDuesAmount(amount)
  } catch (error) {
    throw new DuesPlanError(
      'invalid-fee',
      `설정된 회비 금액을 사용할 수 없습니다. 사무국으로 문의해 주세요. (${(error as Error).message})`
    )
  }

  return {
    amount,
    orderName: `경기아트콜렉티브 ${formatBillingMonth(input.billingMonth)} 조합비`,
  }
}

/**
 * 이 결제가 **어느 달**의 회비인가.
 *
 * 답은 "주문을 만든 때"다. 준비 라우트가 `currentBillingMonth()`로 청구월을
 * 정해 그 달의 청구 행을 만들고, 카드 명세서에 찍힐 주문명에도 그 달을 적는다.
 * 확정이 그 값을 다시 계산하면 **월말 자정을 넘긴 결제가 엉뚱한 달을 납부로
 * 바꾼다** — 9월 30일 23시 59분에 결제창을 열고 10월 1일에 승인이 끝나면
 * 9월분을 낸 회원의 10월분이 납부로 표시되고, 9월은 미납으로 남아 다음 청구가
 * 또 나간다. 10월 행이 아직 없으면 아무 달도 바뀌지 않는다.
 *
 * 대사 크론(`/api/internal/dues/expire`)은 이미 이 규칙을 쓴다 — 며칠 뒤에
 * 도는 대사가 "지금 달"을 적으면 같은 일이 벌어지기 때문이다. 확정만 갈라져
 * 있었다.
 *
 * @returns 'YYYY-MM'. 주문 생성 시각을 읽지 못하면 null.
 */
export function resolveDuesBillingMonth(payment: { created_at?: unknown } | null): string | null {
  const raw = payment?.created_at
  if (typeof raw !== 'string' && !(raw instanceof Date)) return null
  const createdAt = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(createdAt.getTime())) return null
  return currentBillingMonth(createdAt)
}

/**
 * 그 달의 청구가 지금 어떤 상태인가 — **이 결제의 눈으로** 본다.
 *
 * `paid`라는 사실만으로는 답이 갈리지 않는다. 이 결제가 납부로 바꾼 것이면
 * 재확정이고(성공으로 답해야 한다), 다른 결제가 바꾼 것이면 같은 달을 두 번
 * 걷는 중이다(승인하면 안 된다).
 */
export type DuesMonthState =
  /** 미납. 이 결제가 납부로 바꿀 수 있다. */
  | 'open'
  /** 이 결제가 이미 납부로 표시했다. 재확정이므로 성공이다. */
  | 'paid-by-this'
  /** 다른 결제가 그 달을 이미 납부했다. 승인하면 같은 달을 두 번 걷는다. */
  | 'paid-by-other'
  /** 그 달 청구가 취소됐다. 걷을 돈이 없다. */
  | 'canceled'
  /** 그 달 청구 행이 아예 없다. 준비가 만들어 두므로 정상적으로는 없는 상태다. */
  | 'missing'

export function readDuesMonthState(
  dues: { status?: unknown; payment_id?: unknown } | null,
  paymentId: string
): DuesMonthState {
  if (!dues) return 'missing'
  if (dues.status === 'canceled') return 'canceled'
  if (dues.status !== 'paid') return 'open'
  return paymentId && dues.payment_id === paymentId ? 'paid-by-this' : 'paid-by-other'
}

/**
 * 승인을 보내도 되는가. **승인 전에** 부른다.
 *
 * 토스에서 카드가 실제로 긁히는 시점은 승인(`confirmPayment`)이다. 준비와 승인
 * 사이에 그 달이 납부로 바뀌었다면 — 사무국이 계좌이체를 손으로 기록했거나,
 * 회원이 창을 두 개 열어 둘 다 결제했거나 — 여기서 멈추는 것으로 **이중 결제가
 * 일어나지 않는다.** 승인 뒤에 발견하면 남는 일은 환불뿐이다.
 */
export function canConfirmDuesPayment(
  state: DuesMonthState,
  billingMonth: string
): { ok: true } | { ok: false; reason: DuesMonthState; message: string } {
  if (state === 'open' || state === 'paid-by-this') return { ok: true }
  const month = formatBillingMonth(billingMonth)
  if (state === 'paid-by-other') {
    return {
      ok: false,
      reason: state,
      message: `${month} 조합비는 이미 납부 처리되었습니다. 결제를 진행하지 않았으니 마이페이지에서 확인해 주세요.`,
    }
  }
  if (state === 'canceled') {
    return {
      ok: false,
      reason: state,
      message: `${month} 조합비 청구가 취소되었습니다. 사무국으로 문의해 주세요.`,
    }
  }
  return {
    ok: false,
    reason: state,
    message: `${month} 조합비 청구를 찾을 수 없습니다. 사무국으로 문의해 주세요.`,
  }
}
