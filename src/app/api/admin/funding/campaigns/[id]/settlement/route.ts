/**
 * 정산 내역 — 사무국(관리자) 전용.
 *
 * - `GET` 지금 정산서와, **그 자리에서 다시 센 원장 값**을 함께 준다. 둘이
 *   어긋나면(`is_stale`) 화면이 그 사실을 먼저 말한다.
 * - `POST` 정산서를 만들거나 다시 정리한다. 사람이 넣는 값은 결제대행 수수료와
 *   메모뿐이고, 나머지는 서버가 원장에서 다시 센다 — 브라우저가 보낸 금액은
 *   무엇이든 받지 않는다.
 * - `PATCH { action: 'mark_paid' }` 조합이 실제로 돈을 보냈다는 기록. 이 뒤로
 *   숫자는 움직이지 않는다.
 *
 * 캠페인이 `settled`가 되는 것은 여기가 아니라 전이 라우트(`…/transition`)이고,
 * 그쪽은 **지급까지 끝난 정산서**가 있어야만 통과한다
 * (`src/lib/funding/campaignPreconditions.ts`).
 *
 * ## 입금 계좌는 여기서만 나간다
 *
 * 조합은 정산금을 손으로 이체한다. 그러려면 은행·계좌번호·예금주가 화면에
 * 있어야 하고, 그 값은 개설자 프로필에서 온다(`getPayoutAccount`). 이 라우트는
 * `requireAdmin`을 거치므로 **사무국만** 그 값을 받는다 — 개설자 대시보드
 * (`/api/mypage/funding/campaigns/[id]`)로는 계좌가 등록됐는지의 참·거짓만
 * 가고, 알림·활동 기록·로그에는 어느 쪽으로도 계좌가 실리지 않는다.
 *
 * 계좌를 실어 보내는 것은 **남의 금융 정보를 읽는 행위**다. 배송 목록
 * 내보내기와 같은 모양으로 흔적을 남긴다 — 응답을 내보내기 **전에** 기다려
 * 기록하고, 접속 주소와 브라우저를 함께 남기고, 기록이 실패하면
 * `logSecurityEvent`로 올린다. 기록 실패가 조회를 막지는 않는다(정당한
 * 업무다).
 *
 * 그래서 계좌는 **달라고 해야 나간다**(`?account=1`). 관리자 펀딩 목록은
 * 마감된 캠페인마다 정산 패널을 하나씩 그리므로, 조회에 계좌를 끼워 두면
 * 페이지를 한 번 여는 것만으로 마감된 캠페인 전원의 계좌번호가 브라우저에
 * 깔린다 — 아무도 요청하지 않았고, 흔적은 스무 줄이 한꺼번에 남아 무엇을
 * 보려던 것이었는지 알 수 없게 된다. 기본 조회는 **등록됐는가의 참·거짓**만
 * 주고(그건 사무국이 항상 봐야 하는 사실이다), 값은 이체하려는 그 한 건에서
 * 한 번 더 눌렀을 때만 나간다.
 *
 * ## 계좌가 없는 개설자의 지급 기록
 *
 * **거절하지 않는다.** 버튼을 누르는 시점에 이체는 이미 끝난 일이라, 여기서
 * 막아도 나간 돈이 돌아오지 않고 기록만 사라진다 — 없는 기록이 틀린 기록보다
 * 낫지 않다. 대신 **한 번 확인받고**(`acknowledge_no_account`),
 * 등록된 계좌가 없었다는 사실을 활동 기록에 함께 남긴다. 확인 없이 들어온
 * 요청은 409다 — 화면이 계좌가 있다고 믿고 보낸 것이므로, 이 기능의 다른
 * 자리들과 같이 "읽은 상태가 움직였다"로 답한다.
 */

import { NextRequest, NextResponse, after } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { applyRouteRateLimit } from '@/lib/server/rateLimit'
import {
  ACCOUNT_REVEAL_RATE_LIMIT,
  accountRevealRateLimitKey,
} from '@/lib/server/accountRevealLimit'
import { getCampaignById } from '@/db/queries/funding'
import {
  basisOf,
  computeSettlementBasis,
  getSettlementByCampaign,
  markSettlementPaid,
  prepareSettlement,
} from '@/db/queries/fundingSettlements'
import { getPayoutAccount } from '@/db/queries/profiles'
import { logUserActivity } from '@/db/queries/activities'
import { changedSettlementFields, isBasisStale, netAmount } from '@/lib/funding/settlement'
import {
  isPayoutAccountRegistered,
  PAYOUT_ACCOUNT_MISSING_NOTICE,
  type PayoutAccount,
} from '@/lib/funding/payoutAccount'
import { isFundingEnabled } from '@/lib/funding/settings'
import { notifySettlementPaid, notifySettlementPrepared } from '@/lib/funding/notify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/admin/funding/settlement')
export const runtime = 'nodejs'
/**
 * `after()`로 넘긴 정산 준비·지급 알림은 **개설자 한 사람**에게 간다 — 대량
 * 발송기를 타지 않으므로 메일 한 통이 전부다. 그래도 예산을 적어 둔다:
 * 적지 않으면 플랫폼 기본값(10~15초)이고, 이 라우트는 원장을 다시 세고 계좌를
 * 읽는 자리라 Resend가 한 번 느려지면 "정산금을 보냈습니다"가 통째로 사라진다.
 * 한 통이 아무리 늦어도 들어오는 60초로 잡는다.
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** 결제대행 수수료의 상한. 이보다 큰 값은 오타로 본다(억 단위 수수료는 없다). */
const MAX_PG_FEE = 1_000_000_000

/**
 * 개설자의 입금 계좌. 캠페인에 임자가 없으면(수기 등록 뒤 탈퇴 등) `null`이다.
 *
 * 이 함수는 값을 읽기만 한다. **누가 볼 수 있는지는 부르는 자리가 정한다** —
 * 이 파일에서 부르는 곳은 전부 `requireAdmin`을 이미 통과한 뒤다.
 */
async function ownerPayoutAccount(
  campaign: Record<string, unknown>
): Promise<PayoutAccount | null> {
  const ownerId = campaign.owner_user_id
  if (typeof ownerId !== 'string' || ownerId.length === 0) return null
  return getPayoutAccount(ownerId)
}

/**
 * 화면이 쓰는 한 벌. 저장된 정산서·지금 원장·어긋남 여부를 함께 준다.
 *
 * `payout_account_registered`는 **참·거짓만**이다. 계좌 값 자체는 조회(GET)
 * 응답에만 따로 실린다 — 정리·지급 응답까지 계좌를 끼워 보내면 같은 값이
 * 흔적 없이 세 번 더 나가고, 화면은 어차피 조회 때 받아 둔 값을 그대로
 * 쓰면 된다(계좌는 정산서를 고친다고 바뀌지 않는다).
 */
async function settlementPayload(campaign: Record<string, unknown>, account: PayoutAccount | null) {
  const settlement = await getSettlementByCampaign(String(campaign.id))
  const current = await computeSettlementBasis(String(campaign.id))
  return {
    settlement,
    // 아직 정산서가 없어도 화면이 미리 보여 줄 수 있어야 한다 — 관리자가
    // 결제대행 수수료를 넣기 전에 실 모금액이 얼마인지 알아야 하기 때문이다.
    current_basis: { ...current, net_amount: netAmount(current) },
    platform_fee_rate_bp: Number(campaign.platform_fee_rate ?? 0),
    is_stale:
      settlement !== null &&
      settlement.status !== 'paid' &&
      isBasisStale(basisOf(settlement), current),
    payout_account_registered: isPayoutAccountRegistered(account),
  }
}

/**
 * 계좌를 실어 보내기 **전에** 기다려서 남기는 기록.
 *
 * 배송 목록 내보내기(`…/shipping-export`)와 같은 모양이다. 순서가 중요하다 —
 * 응답을 내보낸 뒤에 남기려 들면 서버리스 함수가 얼어붙어 기록이 통째로
 * 사라질 수 있고, 그러면 남의 계좌번호가 아무 흔적도 없이 나간다.
 *
 * **기록에는 계좌를 넣지 않는다.** 남길 것은 "누가 언제 어느 캠페인의 계좌를
 * 봤는가"이지 계좌 자체가 아니다 — 활동 기록은 관리자 화면에 그대로 보이므로,
 * 여기에 넣으면 지금 좁혀 둔 경계 밖으로 값이 한 번 더 새어 나간다.
 */
async function recordPayoutAccountView(
  request: NextRequest,
  userId: string,
  campaignId: string,
  account: PayoutAccount | null
) {
  try {
    await logUserActivity({
      user_id: userId,
      action_type: 'funding_payout_account_viewed',
      target_type: 'funding_campaign',
      target_id: campaignId,
      metadata: { payout_account_registered: isPayoutAccountRegistered(account) },
      ip_address:
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
      user_agent: request.headers.get('user-agent') || null,
    })
  } catch (logError) {
    logSecurityEvent(
      'FUNDING_PAYOUT_ACCOUNT_VIEW_AUDIT_FAILED',
      {
        campaignId,
        error: logError instanceof Error ? logError.message : String(logError),
      },
      'high'
    )
    log.error('입금 계좌 조회 기록 실패', {
      campaignId,
      error: logError instanceof Error ? logError.message : String(logError),
    })
  }
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const campaign = await getCampaignById(id)
  if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  try {
    const account = await ownerPayoutAccount(campaign)
    const reveal = request.nextUrl.searchParams.get('account') === '1'
    // 세는 것은 **계좌가 실제로 나가는 요청뿐**이다. 관리자 펀딩 목록은
    // 마감된 캠페인마다 이 조회를 한 번씩 부르므로(계좌 없이), 그것까지 세면
    // 페이지를 몇 번 여는 것만으로 한도가 닳는다. 조합원 계좌 조회와 같은
    // 카운터다 — 한쪽을 다 쓴 뒤 다른 쪽으로 이어 걷지 못한다.
    if (reveal) {
      const rl = await applyRouteRateLimit(request, {
        ...ACCOUNT_REVEAL_RATE_LIMIT,
        keyGenerator: () => accountRevealRateLimitKey(auth.user.id),
      })
      if (rl.success === false && rl.response) return rl.response
      await recordPayoutAccountView(request, auth.user.id, id, account)
    }
    return ApiSuccess.ok({
      campaign: { id: campaign.id, title: campaign.title, status: campaign.status },
      ...(await settlementPayload(campaign, account)),
      // 사무국 전용, 그리고 달라고 했을 때만. 응답 캐시는 `ApiSuccess`의
      // 기본값(`private, no-store`)이다.
      ...(reveal ? { payout_account: account } : {}),
    }).toNextResponse()
  } catch (error) {
    log.error('정산 내역 조회 실패:', error)
    return ApiError.internalServerError('정산 내역을 불러오지 못했습니다.').toNextResponse()
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    // **사람이 넣는 단 하나의 숫자.** 토스는 수수료를 돌려주지 않고 우리도
    // 적어 두지 않으므로, 이 값만은 계산이 아니라 입력이다.
    const pgFee = Number(body.pg_fee_amount)
    if (!Number.isSafeInteger(pgFee) || pgFee < 0 || pgFee > MAX_PG_FEE) {
      return ApiError.badRequest(
        '결제대행 수수료를 원 단위 정수로 입력해 주세요. 정산서에 적힌 실제 수수료를 그대로 넣습니다.'
      ).toNextResponse()
    }
    const memo = typeof body.memo === 'string' ? body.memo.trim().slice(0, 1000) : null

    const campaign = await getCampaignById(id)
    if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
    const account = await ownerPayoutAccount(campaign)

    const result = await prepareSettlement({
      campaign_id: id,
      platform_fee_rate_bp: Number(campaign.platform_fee_rate ?? 0),
      pg_fee_amount: pgFee,
      memo,
    })
    if (result.ok === false) {
      if (result.reason === 'campaign_not_closed') {
        // 상태를 미리 읽고 판정하지 않는다 — 읽은 뒤 쓰기 사이에 상태가 움직이는
        // 것이 이 기능이 세 번 물린 자리다. 조건부 쓰기의 0행을 그대로 답한다.
        return ApiError.conflict(
          '마감된 프로젝트만 정산할 수 있습니다. 상태가 바뀌었을 수 있으니 새로고침해 주세요.'
        ).toNextResponse()
      }
      if (result.reason === 'already_paid') {
        return ApiError.conflict(
          '이미 지급이 끝난 정산 내역입니다. 지급 뒤에는 금액을 고칠 수 없습니다.'
        ).toNextResponse()
      }
      return ApiError.badRequest(result.message).toNextResponse()
    }

    // 다시 정리하면 앞의 정산서는 같은 행 위에 덮인다 — 표가 하나뿐이라
    // 앞의 숫자는 그 자리에서 사라진다. 조합원에게 줄 돈에 대한 기록이니
    // **뭐라고 적혀 있었고 무엇이 달라졌는지**를 이미 남기고 있던 이 한 줄에
    // 함께 적는다(표를 새로 만들지 않는다).
    //
    // 싣는 것은 금액 칸 여섯뿐이다. 계좌·예금주·후원자 신상은 이 기능의 다른
    // 자리들과 같이 활동 기록에 넣지 않는다 — 활동 기록은 관리자 화면에
    // 그대로 보이므로, 여기 넣는 값은 한 겹 더 넓은 곳으로 나가는 값이다.
    const superseded = result.previous_amounts
    logUserActivity({
      user_id: auth.user.id,
      action_type: 'admin_action',
      target_type: 'funding_campaign',
      target_id: id,
      metadata: {
        action: result.created ? 'settlement_prepared' : 'settlement_recalculated',
        payout_amount: result.amounts.payout_amount,
        pg_fee_amount: result.amounts.pg_fee_amount,
        ...(superseded
          ? {
              superseded_amounts: superseded,
              changed_fields: changedSettlementFields(superseded, result.amounts),
            }
          : {}),
      },
    }).catch(e => log.warn('활동 기록 실패', e))

    // 같은 금액을 두 번 알리지 않는다 — 처음 정리했을 때, 그리고 다시 정리해
    // **지급 예정 금액이 실제로 달라졌을 때**만 개설자에게 간다. 직전 금액은
    // 쿼리 계층이 **쓰기 잠금을 잡은 뒤** 읽어 함께 돌려준 값이다. 여기서 따로
    // 읽으면 두 관리자가 동시에 정리할 때 둘 다 "바뀌었다"로 읽어 같은 금액을
    // 두 번 알린다.
    const payoutChanged =
      superseded === null || superseded.payout_amount !== result.amounts.payout_amount
    if (payoutChanged) {
      // 계좌가 없으면 알림이 그 사실을 함께 말한다 — 사무국이 쫓아다니기
      // 전에 개설자가 먼저 알아야 하고, 그 자리(마이페이지 내 정보)까지
      // 일러 준다. 계좌 **값**은 어느 알림에도 싣지 않는다.
      // 응답 뒤에 보낸다. 맨 promise로 두면 응답과 함께 함수가 얼어 개설자는
      // 정산서가 나왔다는 사실을 받지 못한다.
      after(() =>
        notifySettlementPrepared(campaign, result.settlement as never, {
          revised: result.created === false,
          payoutAccountMissing: isPayoutAccountRegistered(account) === false,
        }).catch(e => log.error('정산 준비 알림 실패', e))
      )
    }

    return ApiSuccess.ok({
      ...(await settlementPayload(campaign, account)),
      campaign: { id: campaign.id, title: campaign.title, status: campaign.status },
    }).toNextResponse()
  } catch (error) {
    log.error('정산 내역 정리 실패:', error)
    return ApiError.internalServerError('정산 내역을 정리하지 못했습니다.').toNextResponse()
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const body = await parseJsonObjectBody(request)
    if (body?.action !== 'mark_paid')
      return ApiError.badRequest('동작이 올바르지 않습니다.').toNextResponse()

    const campaign = await getCampaignById(id)
    if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()

    // 계좌는 **누르는 그 순간에 다시 읽는다.** 화면이 계좌를 보여 준 뒤
    // 개설자가 지웠을 수 있고, 그 경우 확인 없이 들어온 요청은 화면이 이미
    // 틀린 상태를 믿고 있다는 뜻이다. 이 기능의 다른 자리들과 같이 409로
    // 답하고 화면이 다시 읽게 한다.
    const account = await ownerPayoutAccount(campaign)
    const accountRegistered = isPayoutAccountRegistered(account)
    if (accountRegistered === false && body.acknowledge_no_account !== true) {
      return ApiError.conflict(PAYOUT_ACCOUNT_MISSING_NOTICE).toNextResponse()
    }

    const result = await markSettlementPaid(id)
    if (result.ok === false) {
      if (result.reason === 'not_found')
        return ApiError.badRequest(
          '정산 내역을 먼저 정리해 주세요. 지급할 금액이 아직 기록되지 않았습니다.'
        ).toNextResponse()
      if (result.reason === 'already_paid')
        return ApiError.conflict('이미 지급으로 기록된 정산 내역입니다.').toNextResponse()
      // 정산서를 만든 뒤 환불이 들어왔다. 낡은 금액으로 도장을 찍게 두지 않는다.
      return ApiError.conflict(
        `정산 내역을 만든 뒤 후원 환불이 있었습니다. 지금 기준으로 총 모금액 ${result.current.gross_amount.toLocaleString('ko-KR')}원, 환불 ${result.current.refund_amount.toLocaleString('ko-KR')}원입니다. 다시 정리한 뒤 지급을 기록해 주세요.`
      ).toNextResponse()
    }

    // 등록된 계좌가 있었는지를 지급 기록 옆에 남긴다. 계좌가 없는 채로
    // 기록한 건은 **기다려서** 남긴다 — 그 한 줄이 "조합이 알아서 확인한
    // 계좌로 보냈다"는 단서의 전부이고, 놓치면 남는 것은 근거 없이 지급을
    // 주장하는 기록뿐이다. 계좌가 있었던 평범한 건은 기존대로 흘려보낸다.
    const payoutActivity = logUserActivity({
      user_id: auth.user.id,
      action_type: 'admin_action',
      target_type: 'funding_campaign',
      target_id: id,
      metadata: {
        action: 'settlement_paid',
        payout_amount: Number(result.settlement.payout_amount ?? 0),
        payout_account_registered: accountRegistered,
      },
    })
    if (accountRegistered === false) {
      try {
        await payoutActivity
      } catch (e) {
        logSecurityEvent(
          'FUNDING_SETTLEMENT_PAID_WITHOUT_ACCOUNT_AUDIT_FAILED',
          { campaignId: id, error: e instanceof Error ? e.message : String(e) },
          'high'
        )
        log.error('계좌 없는 지급 기록 실패', e)
      }
    } else {
      payoutActivity.catch(e => log.warn('활동 기록 실패', e))
    }

    // 응답 뒤에 보낸다. 맨 promise로 두면 응답과 함께 함수가 얼어 개설자는
    // **자기 돈이 나갔다는 통지**를 받지 못한다.
    after(() =>
      notifySettlementPaid(campaign, result.settlement as never).catch(e =>
        log.error('정산 지급 알림 실패', e)
      )
    )

    return ApiSuccess.ok({
      ...(await settlementPayload(campaign, account)),
      campaign: { id: campaign.id, title: campaign.title, status: campaign.status },
    }).toNextResponse()
  } catch (error) {
    log.error('정산 지급 처리 실패:', error)
    return ApiError.internalServerError('지급을 기록하지 못했습니다.').toNextResponse()
  }
}
