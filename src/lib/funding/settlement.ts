/**
 * 정산 셈의 **정본**. DB도 네트워크도 모른다 — 쿼리 계층과 라우트와 화면이
 * 같은 함수를 부른다.
 *
 * ## 무엇을 시스템이 알고, 무엇을 모르는가
 *
 * 세 값은 후원 원장에서 나온다(`src/db/queries/fundingSettlements.ts`의
 * `computeSettlementBasis`).
 *
 * - **총 모금액(gross)** — 실제로 결제가 잡힌 돈 전부. 나중에 돌려준 돈도
 *   포함한다. "들어온 적 있는 돈"이라 뒤에 무슨 일이 있어도 줄지 않는다.
 * - **환불액(refund)** — 그중 후원자에게 돌아간(또는 돌아가는 중인) 돈.
 * - **후원자 수(backer_count)** — 환불되지 않고 남은 후원 건수. 공개 화면의
 *   후원자 수(`getCampaignProgress`)와 같은 셈이라 두 화면이 어긋나지 않는다.
 *
 * 그래서 **실 모금액 = gross − refund**이고, 이것이 남은 후원(`paid`)의
 * 합과 정확히 같다. 화면을 읽는 사람이 뺄셈 한 번으로 따라올 수 있어야 하므로
 * 이 항등식을 깨는 정의는 쓰지 않는다.
 *
 * **결제대행 수수료(pg_fee)는 시스템이 모른다.** 토스가 돌려주지도 않고 우리가
 * 적어 두지도 않는다. 사람이 정산서를 보고 넣는 값이며, 화면은 이 한 칸만
 * 사람이 넣었다는 것을 분명히 말한다. 추정하지 않고, 비율을 가정하지 않고,
 * 계산된 값인 척 0을 넣어 두지도 않는다.
 *
 * ## 반올림은 창작자 쪽으로
 *
 * 플랫폼 수수료는 만분율(bp)이라 나눗셈이 남는다. **버림(floor)** 한다 —
 * 조합이 가져가는 몫을 조합이 올려 잡지 않는다는 뜻이고, 1원 이하의 차이는
 * 언제나 창작자에게 간다. 원 단위 정수만 쓰고 부동소수점은 쓰지 않는다.
 */

export const SETTLEMENT_STATUSES = ['pending', 'paid'] as const
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number]

/** 후원 원장에서 뽑아 오는, 사람이 손댈 수 없는 세 값. */
export interface SettlementBasis {
  gross_amount: number
  refund_amount: number
  backer_count: number
}

/** 정산 한 건의 모든 숫자. DB 컬럼과 키가 같다. */
export interface SettlementAmounts extends SettlementBasis {
  pg_fee_amount: number
  platform_fee_amount: number
  payout_amount: number
}

export type SettlementComputeResult =
  | { ok: true; amounts: SettlementAmounts; net_amount: number }
  | { ok: false; reason: 'basis' | 'rate' | 'pg_fee' | 'pg_fee_too_large'; message: string }

function isWon(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

/** 실 모금액 — 들어와서 남은 돈. `payout`의 출발점이다. */
export function netAmount(basis: SettlementBasis): number {
  return basis.gross_amount - basis.refund_amount
}

/**
 * 플랫폼 수수료. 실 모금액에 승인 시점에 새긴 요율(bp)을 곱하고 **버린다**.
 *
 * 요율은 캠페인 행의 `platform_fee_rate`를 쓴다 — 지금의 전역 설정이 아니다.
 * 승인 뒤에 사무국이 설정을 바꿔도 이미 승인된 캠페인의 약속은 움직이지
 * 않는다(그래서 애초에 승인 시점에 스냅샷을 새긴다).
 */
export function platformFeeFor(net: number, rateBp: number): number {
  if (net <= 0 || rateBp <= 0) return 0
  return Math.floor((net * rateBp) / 10_000)
}

/**
 * 정산 금액 한 벌을 만든다.
 *
 * `pg_fee_amount`만 사람이 넣고 나머지는 전부 여기서 나온다. 지급액이 음수가
 * 되는 입력은 받지 않는다 — 조용히 0으로 깎으면 잘못 넣은 수수료가 기록에
 * 남지 않은 채 사라진다. 0원 지급 자체는 정상이다(실 모금액이 수수료 합과
 * 같은 경우).
 */
export function computeSettlementAmounts(input: {
  basis: SettlementBasis
  platform_fee_rate_bp: number
  pg_fee_amount: number
}): SettlementComputeResult {
  const { basis } = input
  if (
    !isWon(basis?.gross_amount) ||
    !isWon(basis?.refund_amount) ||
    !isWon(basis?.backer_count) ||
    basis.refund_amount > basis.gross_amount
  ) {
    return { ok: false, reason: 'basis', message: '후원 내역을 합산하지 못했습니다.' }
  }
  const rate = input.platform_fee_rate_bp
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > 3000) {
    return { ok: false, reason: 'rate', message: '플랫폼 수수료율이 올바르지 않습니다.' }
  }
  if (!isWon(input.pg_fee_amount)) {
    return {
      ok: false,
      reason: 'pg_fee',
      message: '결제대행 수수료는 0원 이상의 정수로 입력해 주세요.',
    }
  }
  const net = netAmount(basis)
  const platformFee = platformFeeFor(net, rate)
  const payout = net - input.pg_fee_amount - platformFee
  if (payout < 0) {
    return {
      ok: false,
      reason: 'pg_fee_too_large',
      message: `결제대행 수수료가 너무 큽니다. 실 모금액 ${net.toLocaleString('ko-KR')}원에서 플랫폼 수수료 ${platformFee.toLocaleString('ko-KR')}원을 뺀 ${(net - platformFee).toLocaleString('ko-KR')}원까지 넣을 수 있습니다.`,
    }
  }
  return {
    ok: true,
    net_amount: net,
    amounts: {
      gross_amount: basis.gross_amount,
      refund_amount: basis.refund_amount,
      backer_count: basis.backer_count,
      pg_fee_amount: input.pg_fee_amount,
      platform_fee_amount: platformFee,
      payout_amount: payout,
    },
  }
}

/**
 * 정리해 둔 정산서의 근거가 아직 유효한가.
 *
 * 정산서를 만든 뒤에도 환불은 들어온다(후원자 취소·사무국 환불). 그러면
 * 총 모금액·환불액·후원자 수가 움직이고, 저장된 지급액은 그 순간부터 **틀린
 * 숫자**가 된다. 그래서 읽을 때마다 원장을 다시 세어 이 함수로 대조하고,
 * 어긋나면 화면이 그 사실을 먼저 말한다 — 조용히 낡은 값을 보여 주지 않는다.
 *
 * 지급이 끝난(`paid`) 정산서는 대조하지 않는다. 돈이 이미 나갔으므로 그때의
 * 숫자가 곧 사실이고, 뒤에 원장이 움직였다면 그것은 별도의 사건이다.
 */
export function isBasisStale(stored: SettlementBasis, current: SettlementBasis): boolean {
  return (
    stored.gross_amount !== current.gross_amount ||
    stored.refund_amount !== current.refund_amount ||
    stored.backer_count !== current.backer_count
  )
}

/** 화면과 알림이 함께 쓰는 한국어 표기. */
export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: '지급 전',
  paid: '지급 완료',
}

export function isSettlementStatus(value: unknown): value is SettlementStatus {
  return typeof value === 'string' && (SETTLEMENT_STATUSES as readonly string[]).includes(value)
}
