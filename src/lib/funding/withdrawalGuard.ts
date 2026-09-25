/**
 * 탈퇴 신청을 펀딩 때문에 막아야 하는가 — **이 질문의 답은 여기서만 정한다.**
 *
 * 탈퇴는 계정을 지우는 일이 아니라 **조합과의 관계를 끊는 일**이고, 확정되면
 * 정산금을 받을 주체와 리워드를 보낼 책임자가 사라진다. 그런데 신청 라우트는
 * 이 사람이 무엇을 벌여 놓았는지 보지 않았다 — 심사 중이거나 후원을 받고 있는
 * 프로젝트를 열어 둔 채로, 또는 마감은 했지만 리워드를 아직 보내지 않은 채로
 * 신청이 접수됐다. 관리자가 그 사실을 모르고 확정하면 후원자는 돈을 낸 채
 * 상대를 잃는다.
 *
 * 그래서 **막는다** — 없애는 것이 아니라 사무국을 거치게 한다. 정산·환불·이행
 * 인계를 사람이 맞춰 본 뒤에야 탈퇴가 성립한다.
 *
 * 문 셋을 순서대로 본다. ① 진행 중인 프로젝트, ② **정산금 지급이 끝나지 않은
 * 프로젝트**, ③ 아직 전달하지 않은 리워드. ②가 ③보다 앞인 것은 우연이 아니다 —
 * ③은 개설자가 스스로 누르는 값이라 탈퇴 직전에 전부 '전달 완료'로 눌러
 * 비켜설 수 있지만, ②의 `'paid'`는 사무국만 찍는다.
 *
 * 이 파일은 **아무것도 import 하지 않는다.** 판정에 필요한 것을 호출부가
 * 조립해 넘기므로(다른 펀딩 헬퍼와 같은 방식) 데이터베이스 없이 전수
 * 테스트할 수 있다.
 */

/** 아직 돌아가는 중 — 후원자가 지금도 붙고 있거나, 붙기를 기다리고 있다. */
const IN_PROGRESS_STATUSES = ['submitted', 'active'] as const

/** 끝났지만 책임이 남을 수 있는 상태 — 정산과 리워드를 따로 본다. */
const FINISHED_STATUSES = ['closed', 'settled'] as const

export interface CampaignForWithdrawal {
  status: string
  /**
   * 결제까지 마쳤는데 **아직 전달되지 않은** 후원 건수(`fulfillment_status`가
   * `'delivered'`가 아닌 것). `submitted`·`active`는 이 값을 보지 않으므로
   * 호출부가 0으로 두어도 된다.
   */
  undelivered_pledge_count?: number
  /**
   * 환불되지 않고 남은 결제 완료 후원 건수. **0이면 지급할 돈이 없다** —
   * 정산서를 만들 이유도 없으므로 정산 검사에서 빠진다.
   */
  paid_pledge_count?: number
  /**
   * 정산서의 상태(`'pending'` | `'paid'`). 아직 만들지 않았으면 `null`.
   * `'paid'`여야 지급이 실제로 나갔다는 뜻이다.
   */
  settlement_status?: string | null
}

export type WithdrawalCampaignVerdict =
  | { blocked: false }
  | {
      blocked: true
      reason: 'in_progress' | 'settlement_unpaid' | 'undelivered'
      message: string
    }

const CONTACT = '사무국(contact@ggac.kr)으로 문의해 주세요.'

/**
 * 걸리는 것이 여럿이면 **사람이 할 일의 순서대로** 하나만 말한다 —
 * 진행 중(마감) → 정산금 지급 → 리워드 전달.
 */
export function campaignWithdrawalVerdict(
  campaigns: readonly CampaignForWithdrawal[] | null | undefined
): WithdrawalCampaignVerdict {
  const list = campaigns ?? []

  const inProgress = list.filter(c =>
    (IN_PROGRESS_STATUSES as readonly string[]).includes(c.status)
  ).length
  if (inProgress > 0) {
    return {
      blocked: true,
      reason: 'in_progress',
      message:
        `진행 중인 펀딩 프로젝트가 ${inProgress}건 있어 탈퇴를 신청할 수 없습니다. ` +
        `심사·모금이 끝나고 정산이 마무리된 뒤에 신청할 수 있습니다. ${CONTACT}`,
    }
  }

  // 정산금이 아직 나가지 않았으면 막는다 — **이 검사가 아래 리워드 검사보다
  // 먼저다.**
  //
  // 이유 둘. ① 지급받을 계좌는 탈퇴하는 본인의 프로필에 있고, 확정은 그것을
  // 지운다(`PII_NULL_FIELDS`의 `bank_name`·`account_number`·`account_holder`).
  // 지급 전에 지우면 사무국은 얼마를 누구에게 보내야 하는지 알 수 없다.
  // ② 아래 리워드 검사는 **개설자가 스스로 누른 값**(`fulfillment_status`)에
  // 기대고 있어, 탈퇴 직전에 전부 '전달 완료'로 눌러 버리면 그대로 열린다.
  // 정산서의 `'paid'`는 사무국이 찍는 도장이라 개설자가 움직일 수 없다.
  //
  // 정산서가 **없어도** 결제된 후원이 남아 있으면 막는다 — 정산서를 아직
  // 만들지 않았을 뿐, 보낼 돈은 있다는 뜻이다. 반대로 결제된 후원이 하나도
  // 없고 정산서도 없으면 보낼 돈 자체가 없으니 지나간다.
  const unsettled = list.filter(c => {
    if (!(FINISHED_STATUSES as readonly string[]).includes(c.status)) return false
    if (c.settlement_status === 'paid') return false
    if (c.settlement_status != null) return true
    return Math.max(0, Number(c.paid_pledge_count) || 0) > 0
  }).length
  if (unsettled > 0) {
    return {
      blocked: true,
      reason: 'settlement_unpaid',
      message:
        `정산금 지급이 끝나지 않은 펀딩 프로젝트가 ${unsettled}건 있어 탈퇴를 신청할 수 없습니다. ` +
        `탈퇴가 확정되면 지급받을 계좌 정보도 함께 지워집니다. 정산금을 모두 받은 뒤에 신청할 수 있습니다. ${CONTACT}`,
    }
  }

  const undelivered = list
    .filter(c => (FINISHED_STATUSES as readonly string[]).includes(c.status))
    .reduce((sum, c) => sum + Math.max(0, Number(c.undelivered_pledge_count) || 0), 0)
  if (undelivered > 0) {
    return {
      blocked: true,
      reason: 'undelivered',
      message:
        `아직 전달하지 않은 리워드가 ${undelivered}건 있어 탈퇴를 신청할 수 없습니다. ` +
        `후원자에게 리워드를 모두 전달한 뒤에 신청할 수 있습니다. ${CONTACT}`,
    }
  }

  return { blocked: false }
}
