/**
 * 조합비 결제 도메인 규칙.
 *
 * "이번 달 회비를 결제할 수 있는가, 얼마인가"의 판단만 담는다 — DB도 토스도
 * 모른다. 라우트가 이 판단을 인라인으로 하면 요청 스코프 없이는 테스트할 수
 * 없게 되고, 결국 결제 금액을 정하는 규칙이 검증되지 않은 채 남는다.
 */

import { assertDuesAmount } from './toss/config.ts'

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
