import { NextRequest, NextResponse } from 'next/server'

import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { requestWithdrawal, cancelWithdrawal } from '@/db/queries/withdrawal'
import { listCampaignsByOwner } from '@/db/queries/funding'
import { listPledgesByCampaign } from '@/db/queries/fundingPledges'
import { campaignWithdrawalVerdict } from '@/lib/funding/withdrawalGuard'
import { rateLimit } from '@/lib/server/rateLimit'

/**
 * 이 사람이 펀딩에 벌여 놓은 것을 판정에 넘길 모양으로 모은다. 마감·정산된
 * 프로젝트만 후원을 세어 본다 — 진행 중인 것은 그것만으로 이미 막히므로
 * 쿼리를 더 쏠 이유가 없다.
 */
async function collectOwnedCampaigns(userId: string) {
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

export const dynamic = 'force-dynamic'

/** 탈퇴 신청. 확정은 관리자가 한다 — 이 단계에서는 아무것도 지워지지 않는다. */
export async function POST(request: NextRequest) {
  // 게시글 작성만큼 무거운 쓰기는 아니지만 상태를 바꾸는 쓰기다. 같은 날
  // 만든 다른 상태변경 라우트(mypage/profile PATCH)와 같은 GENERAL_API를
  // 쓴다 — 신청·취소는 사람이 반복할 이유가 없는 동작이라 더 낮은 상한을
  // 새로 만들 근거가 없다.
  const rl = await rateLimit(request, 'GENERAL_API')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth

  // 펀딩을 열어 둔 채로는 신청을 받지 않는다. 탈퇴가 확정되면 정산금을 받을
  // 주체와 리워드를 보낼 책임자가 사라진다 — 후원자는 돈을 낸 채 상대를 잃는다.
  // 없애는 것이 아니라 사무국을 거치게 하는 것이므로 문장이 그 길을 알려 준다.
  const funding = campaignWithdrawalVerdict(await collectOwnedCampaigns(auth.user.id))
  if (funding.blocked) {
    return ApiError.conflict(funding.message).toNextResponse()
  }

  const ok = await requestWithdrawal(auth.user.id)
  if (!ok) {
    return ApiError.conflict('지금 상태에서는 탈퇴를 신청할 수 없습니다.').toNextResponse()
  }
  // 정확한 타임스탬프는 싣지 않는다 — 호출부(설정 화면)가 세션을 강제
  // 재조회해 권위 있는 값을 가져온다.
  return ApiSuccess.ok({ requested: true }, '탈퇴 신청이 접수되었습니다.').toNextResponse()
}

/** 신청 취소. 관리자가 확정하기 전까지 회원이 되돌릴 수 있다. */
export async function DELETE(request: NextRequest) {
  const rl = await rateLimit(request, 'GENERAL_API')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth

  const ok = await cancelWithdrawal(auth.user.id)
  if (!ok) {
    return ApiError.conflict('취소할 탈퇴 신청이 없습니다.').toNextResponse()
  }
  return ApiSuccess.ok({ requested: false }, '탈퇴 신청을 취소했습니다.').toNextResponse()
}
