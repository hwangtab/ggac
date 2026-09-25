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
 * 이 파일은 **아무것도 import 하지 않는다.** 판정에 필요한 것을 호출부가
 * 조립해 넘기므로(다른 펀딩 헬퍼와 같은 방식) 데이터베이스 없이 전수
 * 테스트할 수 있다.
 */

/** 아직 돌아가는 중 — 후원자가 지금도 붙고 있거나, 붙기를 기다리고 있다. */
const IN_PROGRESS_STATUSES = ['submitted', 'active'] as const

/** 끝났지만 책임이 남을 수 있는 상태 — 리워드를 다 보냈는지 따로 본다. */
const FINISHED_STATUSES = ['closed', 'settled'] as const

export interface CampaignForWithdrawal {
  status: string
  /**
   * 결제까지 마쳤는데 **아직 전달되지 않은** 후원 건수(`fulfillment_status`가
   * `'delivered'`가 아닌 것). `submitted`·`active`는 이 값을 보지 않으므로
   * 호출부가 0으로 두어도 된다.
   */
  undelivered_pledge_count?: number
}

export type WithdrawalCampaignVerdict =
  | { blocked: false }
  | { blocked: true; reason: 'in_progress' | 'undelivered'; message: string }

const CONTACT = '사무국(contact@ggac.kr)으로 문의해 주세요.'

/**
 * 진행 중인 프로젝트가 우선이다 — 둘 다 걸리면 그쪽을 먼저 말한다. 사람이
 * 해야 할 일(마감·정산)의 순서가 그렇기 때문이다.
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
