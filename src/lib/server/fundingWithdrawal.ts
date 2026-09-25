/**
 * 탈퇴를 펀딩 때문에 막아야 하는가 — **판정에 필요한 것을 DB에서 모아 온다.**
 *
 * 규칙 자체는 `@/lib/funding/withdrawalGuard`(순수)에 있다. 여기서는 그
 * 규칙이 먹을 모양으로 이 사람의 프로젝트를 조립할 뿐이다.
 *
 * 두 곳이 같은 함수를 쓴다 — 회원의 **신청**(`/api/mypage/withdrawal`)과
 * 사무국의 **확정**(`/api/admin/member-action`). 신청만 막으면 이 가드가
 * 생기기 전에 들어온 신청은 그대로 확정될 수 있고, 가드가 생긴 뒤에도
 * 신청과 확정 사이에 캠페인이 다시 열릴 수 있다. 확정이 되돌릴 수 없는
 * 쪽이므로 검사는 거기에도 있어야 한다.
 *
 * **읽기만 한다. 누가 부를 수 있는지는 부르는 자리가 정한다.**
 */

import { listCampaignsByOwner } from '@/db/queries/funding'
import { listPledgesByCampaign } from '@/db/queries/fundingPledges'
import {
  campaignWithdrawalVerdict,
  type WithdrawalCampaignVerdict,
} from '@/lib/funding/withdrawalGuard'

/**
 * 마감·정산된 프로젝트만 후원을 세어 본다 — 진행 중인 것은 그것만으로 이미
 * 막히므로 쿼리를 더 쏠 이유가 없다.
 */
export async function collectOwnedCampaignsForWithdrawal(userId: string) {
  const campaigns = await listCampaignsByOwner(userId)
  return Promise.all(
    campaigns.map(async c => {
      const status = String(c.status)
      if (status !== 'closed' && status !== 'settled') {
        return { status, undelivered_pledge_count: 0 }
      }
      const pledges = await listPledgesByCampaign(String(c.id), { status: 'paid' })
      return {
        status,
        undelivered_pledge_count: pledges.filter(p => p.fulfillment_status !== 'delivered').length,
      }
    })
  )
}

/** 이 사람의 탈퇴를 펀딩이 막는가. 막으면 화면에 그대로 적을 문장이 딸려 온다. */
export async function fundingWithdrawalVerdictFor(
  userId: string
): Promise<WithdrawalCampaignVerdict> {
  return campaignWithdrawalVerdict(await collectOwnedCampaignsForWithdrawal(userId))
}
