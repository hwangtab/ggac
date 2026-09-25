/**
 * 사무국 이행·환불 표의 한 줄이 **무엇을 말해야 하는가**. DB도 화면도 모른다.
 *
 * ## 왜 갈라야 하나
 *
 * `funding_pledges.status`만 보면 `canceled`가 한 덩어리다. 그런데 그 안에는
 * 서로 정반대인 두 가지가 섞여 있다.
 *
 * ① **돈이 잡힌 적 없는 취소** — 결제가 실패했거나 선점만 하고 끝난 건.
 *    `payment_id`가 비어 있다. 사무국이 할 일이 없다.
 * ② **승인까지 갔는데 환불이 불확실하게 끝난 취소** — 환불이 선점
 *    (`paid → canceled`)까지 마치고 토스 응답을 판단하지 못한 채 끝났다.
 *    `payment_id`가 남아 있다. **돈은 후원자에게 돌아가지 않았을 수 있다.**
 *
 * 둘을 똑같이 "취소 처리 중"으로 그리면 ②가 ①의 더미에 묻힌다 — 환불이
 * 진행 중인 것처럼 보이지만 아무도 아무것도 하고 있지 않다. 그래서 ②는
 * **환불 확인 필요**라고 부르고, 그 줄에만 재시도 단추를 붙인다
 * (`planOfficeRefund`의 `retry`가 같은 판정을 서버에서 한다).
 *
 * 이 파일은 아무것도 import 하지 않는다 — 판정에 필요한 두 칸을 호출부가
 * 넘긴다(`scripts/testing/fundingPledgeRowState.test.mjs`).
 */

/** 판정에 쓰는 것은 후원 행의 두 칸뿐이다. */
export interface PledgeRowFacts {
  status: string
  /** 결제 행이 붙어 있는가 — 곧 "돈이 한 번 잡혔는가". */
  has_payment: boolean
}

export type PledgeRowTone = 'neutral' | 'warn' | 'done'

export interface PledgeRowState {
  /** 표에 찍히는 말. */
  label: string
  tone: PledgeRowTone
  /** 지금 전액 환불을 걸 수 있는 줄인가(결제가 살아 있는 `paid`). */
  canRefund: boolean
  /** 환불이 불확실하게 끝나 다시 걸어 봐야 하는 줄인가. */
  canRetryRefund: boolean
  /** 왜 손이 필요한지 한 줄. 필요 없는 줄에는 없다. */
  hint: string | null
}

const RETRY_HINT =
  '환불이 시작됐지만 결과를 확인하지 못한 채 끝난 후원입니다. 돈이 아직 돌아가지 않았을 수 있습니다 — 토스 거래 내역을 확인한 뒤 환불을 다시 걸어 주세요. 이미 환불됐다면 기록만 맞춰집니다.'

export function pledgeRowState(row: PledgeRowFacts | null | undefined): PledgeRowState {
  const status = typeof row?.status === 'string' ? row.status : ''
  const hasPayment = row?.has_payment === true

  if (status === 'paid') {
    return {
      label: '결제 완료',
      tone: 'neutral',
      canRefund: true,
      canRetryRefund: false,
      hint: null,
    }
  }
  if (status === 'refunded') {
    return { label: '환불됨', tone: 'done', canRefund: false, canRetryRefund: false, hint: null }
  }
  if (status === 'canceled') {
    return hasPayment
      ? {
          label: '환불 확인 필요',
          tone: 'warn',
          canRefund: false,
          canRetryRefund: true,
          hint: RETRY_HINT,
        }
      : {
          label: '결제 안 됨',
          tone: 'neutral',
          canRefund: false,
          canRetryRefund: false,
          hint: null,
        }
  }
  if (status === 'pending') {
    return {
      label: '결제 대기',
      tone: 'neutral',
      canRefund: false,
      canRetryRefund: false,
      hint: null,
    }
  }
  if (status === 'expired') {
    return {
      label: '기한 만료',
      tone: 'neutral',
      canRefund: false,
      canRetryRefund: false,
      hint: null,
    }
  }
  return {
    label: status || '알 수 없음',
    tone: 'neutral',
    canRefund: false,
    canRetryRefund: false,
    hint: null,
  }
}
