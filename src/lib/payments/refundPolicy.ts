/**
 * 공연 예매 취소 시 돌려줄 금액.
 *
 * 근거는 공정거래위원회 **소비자분쟁해결기준**의 공연 관람 항목이고, 토스에
 * 회신한 환불 규정과 같은 값이다 — 회신·화면·코드가 어긋나면 그게 그대로
 * 분쟁이 된다. 값을 바꾸려면 세 곳을 함께 고쳐야 한다.
 *
 * DB도 결제사도 모르는 순수 함수다. 그래서 돈이 걸린 이 계산을 네트워크 없이
 * 테스트로 고정할 수 있다(`scripts/testing/ticket-refund-policy.test.mjs`).
 */

/** 공연일까지 남은 일수 → 공제율. 위에서부터 먼저 맞는 구간을 쓴다. */
const DEDUCTION_TABLE: Array<{ minDaysBefore: number; rate: number }> = [
  { minDaysBefore: 10, rate: 0 }, // 10일 전까지 전액
  { minDaysBefore: 7, rate: 0.1 }, // 9~7일 전
  { minDaysBefore: 3, rate: 0.2 }, // 6~3일 전
  { minDaysBefore: 1, rate: 0.3 }, // 2~1일 전
]

export interface RefundQuote {
  refundable: boolean
  /** 환불할 금액(원). 취소할 수 없으면 0. */
  refundAmount: number
  /** 공제율(0~1). 취소할 수 없으면 1. */
  deductionRate: number
  /** 공제 없이 전액인가. 토스는 금액을 안 실으면 전액 취소로 처리한다. */
  isFullRefund: boolean
  /** 공연일까지 남은 일수(한국 날짜 기준). 지났으면 음수. */
  daysBefore: number
  /** 사람이 읽을 안내. 취소할 수 없는 경우 그 이유가 들어간다. */
  reason: string
}

/** 한국 시간대의 달력 날짜(YYYY-MM-DD)로 바꾼다. */
function toSeoulDateString(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

/**
 * 두 시점 사이의 **날짜** 차이. 시각은 보지 않는다.
 *
 * 시각으로 재면 같은 날 오전에 취소한 사람과 오후에 취소한 사람의 공제율이
 * 달라지는데, 안내에는 "며칠 전"이라고만 적혀 있어 설명할 수 없다.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const fromUtc = Date.parse(`${toSeoulDateString(from)}T00:00:00Z`)
  const toUtc = Date.parse(`${toSeoulDateString(to)}T00:00:00Z`)
  return Math.round((toUtc - fromUtc) / 86400_000)
}

export function calculateTicketRefund(input: {
  totalAmount: number
  /** 공연 시작 시각(ISO 문자열 또는 Date). */
  showStartsAt: string | Date
  now?: Date
}): RefundQuote {
  const now = input.now ?? new Date()
  const showStartsAt =
    input.showStartsAt instanceof Date ? input.showStartsAt : new Date(input.showStartsAt)

  const daysBefore = calendarDaysBetween(now, showStartsAt)

  // 당일과 그 이후는 취소할 수 없다. 공연이 이미 열렸거나 열리는 중이다.
  if (daysBefore <= 0) {
    return {
      refundable: false,
      refundAmount: 0,
      deductionRate: 1,
      isFullRefund: false,
      daysBefore,
      reason:
        daysBefore === 0
          ? '공연 당일에는 취소할 수 없습니다. 사무국으로 문의해 주세요.'
          : '이미 종료된 공연입니다.',
    }
  }

  const tier = DEDUCTION_TABLE.find(row => daysBefore >= row.minDaysBefore)
  const deductionRate = tier?.rate ?? 0.3

  // 공제액에 소수가 생기면 **내림**한다 — 그만큼 환불액이 커져 관객에게
  // 유리하다. 사업자가 몇 원 손해 보는 방향이 분쟁을 줄인다.
  const deduction = Math.floor(input.totalAmount * deductionRate)
  const refundAmount = Math.max(0, input.totalAmount - deduction)

  return {
    refundable: true,
    refundAmount,
    deductionRate,
    isFullRefund: deduction === 0,
    daysBefore,
    reason:
      deduction === 0
        ? '전액 환불됩니다.'
        : `공연 ${daysBefore}일 전 취소로 ${Math.round(deductionRate * 100)}%(${deduction.toLocaleString('ko-KR')}원)가 공제됩니다.`,
  }
}
