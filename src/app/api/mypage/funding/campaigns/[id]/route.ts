import { NextRequest, NextResponse } from 'next/server'

import { requireCampaignActor } from '@/lib/server/memberAuth'
import {
  getCampaignById,
  listRewards,
  updateCampaignFields,
  getCampaignProgress,
} from '@/db/queries/funding'
import { listPledgesByCampaign } from '@/db/queries/fundingPledges'
import { getSettlementByCampaign, isSettlementStale } from '@/db/queries/fundingSettlements'
import { getPayoutAccount } from '@/db/queries/profiles'
import { cooperativeLossFor } from '@/lib/funding/settlement'
import { isPayoutAccountRegistered } from '@/lib/funding/payoutAccount'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { isApprovedActiveAdmin } from '@/lib/server/authz'
import { editScope, type CampaignStatus } from '@/lib/funding/transitions'
import { parseCampaignPatch } from '@/lib/funding/campaignInput'
import { isFundingEnabled } from '@/lib/funding/settings'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * 개설자에게 보이는 후원 행. 배송 리워드가 아니면 연락처·주소는 싣지 않는다.
 *
 * **후원자 이메일은 배송 리워드에도 싣지 않는다.** 택배를 부치는 데 필요한
 * 것은 받는 사람 이름·전화번호·주소이고 그 셋은 그대로 간다. 이메일은 거기에
 * 보태는 편의였는데, 이 화면이 함께 주는 `pledge_code`와 짝이 되는 순간
 * **남의 결제를 환불하는 버튼**이 된다 — 후원 취소의 비회원 경로가 번호+이메일
 * 한 쌍을 열쇠로 쓰기 때문이다(`src/app/api/funding/pledges/cancel/route.ts`).
 * 그쪽에도 "임자 있는 후원은 세션이 임자일 때만"이라는 조건을 넣었지만, 한쪽만
 * 고치면 다른 쪽이 그대로 문이 되므로 둘 다 닫는다.
 *
 * 값을 치른다 — 개설자가 후원자에게 메일로 연락할 길이 화면에서 사라진다.
 * 그런 일은 사무국(contact@ggac.kr)을 거친다.
 */
function ownerPledgeView(p: Record<string, unknown>, shippingRewardIds: Set<string>) {
  const ships = shippingRewardIds.has(String(p.reward_id))
  return {
    id: p.id,
    pledge_code: p.pledge_code,
    status: p.status,
    reward_title: p.reward_title,
    quantity: p.quantity,
    total_amount: p.total_amount,
    paid_at: p.paid_at,
    backer_name: p.is_anonymous ? '익명' : p.backer_name,
    supporter_message: p.supporter_message,
    // 부클릿·웹사이트에 실으려고 받은 이름이라 공개 명단에도 나간다 — 개설자가
    // 명단을 만들 수 있도록 익명 후원이어도 그대로 싣는다.
    credit_name: p.credit_name ?? null,
    fulfillment_status: p.fulfillment_status,
    ...(ships
      ? {
          shipping_name: p.shipping_name,
          shipping_phone: p.shipping_phone,
          shipping_postcode: p.shipping_postcode,
          shipping_address1: p.shipping_address1,
          shipping_address2: p.shipping_address2,
          shipping_memo: p.shipping_memo,
        }
      : {}),
  }
}

/**
 * 개설자에게 보이는 정산 내역.
 *
 * **창작자는 이 거래의 상대방이다.** 얼마를 받게 되는지 알려고 사무국에
 * 전화를 걸어야 한다면 그건 기록이 있는 것이 아니다. 그래서 정산서가 만들어진
 * 순간부터 보인다 — 지급 전이면 '지급 전'이라고 분명히 적고, 숫자가 어떻게
 * 나왔는지 항목을 전부 보여 준다.
 *
 * **사무국 메모(`memo`)는 싣지 않는다.** 그 칸은 내부 기록용이라 상대방에게
 * 보내는 약속이 아니다 — 개설자에게 할 말은 메모가 아니라 알림과 화면의
 * 문장으로 한다.
 *
 * `is_stale`은 "정산서를 만든 뒤 환불이 들어와 금액이 다시 계산될 것"이라는
 * 뜻이다. 그 사실을 감추고 낡은 숫자만 보여 주면, 창작자는 오지 않을 금액을
 * 기다린다.
 *
 * **계좌는 값이 아니라 참·거짓으로만 싣는다**(`payout_account_registered`).
 * 조합이 돈을 보낼 계좌가 등록돼 있는지는 개설자가 지급 전에 알아야 하는
 * 사실이고, 비어 있으면 화면이 고치러 갈 자리를 함께 가리킨다. 계좌 값 자체를
 * 여기 실을 이유는 없다 — 그것을 보는 자리는 마이페이지 내 정보이고, 이
 * 라우트는 사무국도 지나가므로(`canManageCampaign`) 값을 실으면 개설자 화면을
 * 빌려 남의 계좌를 보내는 경로가 하나 더 생긴다.
 */
function creatorSettlementView(
  settlement: Record<string, unknown>,
  isStale: boolean,
  payoutAccountRegistered: boolean,
  /** 승인할 때 이 캠페인에 새긴 수수료율(bp). 지금 설정값이 아니다. */
  platformFeeRateBp: number
) {
  return {
    payout_account_registered: payoutAccountRegistered,
    // 수수료 금액만 보이고 요율이 없으면 "얼마를 뗀 것인지"를 개설자가 되짚을
    // 수 없다. 요율은 조합원 3.3% / 비조합원 5.5%로 갈리므로 더욱 그렇다.
    platform_fee_rate_bp: platformFeeRateBp,
    status: settlement.status,
    gross_amount: settlement.gross_amount,
    refund_amount: settlement.refund_amount,
    net_amount: Number(settlement.gross_amount ?? 0) - Number(settlement.refund_amount ?? 0),
    pg_fee_amount: settlement.pg_fee_amount,
    platform_fee_amount: settlement.platform_fee_amount,
    payout_amount: settlement.payout_amount,
    backer_count: settlement.backer_count,
    paid_out_at: settlement.paid_out_at,
    is_stale: isStale,
    // 수수료가 실 모금액보다 클 때의 차액. 저장된 값들에서 되짚는다 —
    // 컬럼을 만들면 손으로 맞춰야 하는 숫자가 하나 더 생긴다.
    cooperative_loss_amount: cooperativeLossFor(
      settlement as Parameters<typeof cooperativeLossFor>[0]
    ),
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireCampaignActor()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const campaign = await getCampaignById(id)
  if (
    !campaign ||
    !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const [rewards, pledges, progress, settlement] = await Promise.all([
    listRewards(id),
    listPledgesByCampaign(id, { status: 'paid' }),
    getCampaignProgress(id),
    getSettlementByCampaign(id),
  ])
  const settlementStale = settlement ? await isSettlementStale(settlement) : false
  // 계좌 세 칸만 읽고, 그중 아무것도 응답에 싣지 않는다 — 나가는 것은 아래
  // `creatorSettlementView`가 만드는 참·거짓 하나뿐이다.
  const ownerId = campaign.owner_user_id
  const payoutAccountRegistered =
    settlement !== null && typeof ownerId === 'string' && ownerId.length > 0
      ? isPayoutAccountRegistered(await getPayoutAccount(ownerId))
      : false
  const shippingIds = new Set(rewards.filter(r => r.requires_shipping).map(r => String(r.id)))
  return ApiSuccess.ok({
    campaign,
    rewards,
    progress,
    pledges: pledges.map(p => ownerPledgeView(p, shippingIds)),
    settlement: settlement
      ? creatorSettlementView(
          settlement,
          settlementStale,
          payoutAccountRegistered,
          Number(campaign.platform_fee_rate ?? 0)
        )
      : null,
    edit_scope: editScope(campaign.status as CampaignStatus),
    // 이행 상태를 되돌리는 것은 사무국만 할 수 있다. 화면이 그 버튼을 보일지
    // 정하려면 이 값이 필요하다 — 없으면 대부분의 사람에게 눌러도 거절당하는
    // 버튼을 보이게 된다. 권한 판정 자체는 언제나 라우트가 다시 한다.
    is_admin: isApprovedActiveAdmin(auth.profile),
  }).toNextResponse()
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireCampaignActor()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  // 본문을 **먼저** 끝까지 읽는다. 상태를 읽고 편집 범위를 정한 뒤에 읽으면,
  // 본문이 도착하는 시점을 요청자가 쥐고 있으므로 그 사이에 제출·승인이 끼어들
  // 수 있다 — 그러면 낡은 범위로 검증하게 된다(전이 라우트와 같은 순서다).
  const body = await parseJsonObjectBody(request)
  if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

  const campaign = await getCampaignById(id)
  if (
    !campaign ||
    !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const status = campaign.status as CampaignStatus
  const scope = editScope(status)
  if (scope === 'none')
    return ApiError.badRequest('지금 상태에서는 수정할 수 없습니다.').toNextResponse()

  const parsed = parseCampaignPatch(body, scope)
  if (parsed.ok === false) return ApiError.badRequest(parsed.message).toNextResponse()

  // 순서를 바로잡아도 판정과 쓰기 사이의 창은 남는다. 판정 근거가 된 상태를
  // 쓰기 조건으로 함께 걸어, 그 사이에 상태가 움직였으면 아무것도 쓰지 않는다.
  const updated = await updateCampaignFields(id, parsed.patch, { requireStatus: status })
  if (!updated)
    return ApiError.conflict('상태가 이미 바뀌었습니다. 새로고침해 주세요.').toNextResponse()
  return ApiSuccess.ok({ campaign: updated }).toNextResponse()
}
