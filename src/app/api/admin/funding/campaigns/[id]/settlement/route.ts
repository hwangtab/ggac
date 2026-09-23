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
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { getCampaignById } from '@/db/queries/funding'
import {
  basisOf,
  computeSettlementBasis,
  getSettlementByCampaign,
  markSettlementPaid,
  prepareSettlement,
} from '@/db/queries/fundingSettlements'
import { logUserActivity } from '@/db/queries/activities'
import { isBasisStale, netAmount } from '@/lib/funding/settlement'
import { isFundingEnabled } from '@/lib/funding/settings'
import { notifySettlementPaid, notifySettlementPrepared } from '@/lib/funding/notify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/admin/funding/settlement')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** 결제대행 수수료의 상한. 이보다 큰 값은 오타로 본다(억 단위 수수료는 없다). */
const MAX_PG_FEE = 1_000_000_000

/** 화면이 쓰는 한 벌. 저장된 정산서·지금 원장·어긋남 여부를 함께 준다. */
async function settlementPayload(campaign: Record<string, unknown>) {
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
  }
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const campaign = await getCampaignById(id)
  if (!campaign) return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  try {
    return ApiSuccess.ok({
      campaign: { id: campaign.id, title: campaign.title, status: campaign.status },
      ...(await settlementPayload(campaign)),
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

    logUserActivity({
      user_id: auth.user.id,
      action_type: 'admin_action',
      target_type: 'funding_campaign',
      target_id: id,
      metadata: {
        action: result.created ? 'settlement_prepared' : 'settlement_recalculated',
        payout_amount: result.amounts.payout_amount,
        pg_fee_amount: result.amounts.pg_fee_amount,
      },
    }).catch(e => log.warn('활동 기록 실패', e))

    // 같은 금액을 두 번 알리지 않는다 — 처음 정리했을 때, 그리고 다시 정리해
    // **지급 예정 금액이 실제로 달라졌을 때**만 개설자에게 간다. 직전 금액은
    // 쿼리 계층이 **쓰기 잠금을 잡은 뒤** 읽어 함께 돌려준 값이다. 여기서 따로
    // 읽으면 두 관리자가 동시에 정리할 때 둘 다 "바뀌었다"로 읽어 같은 금액을
    // 두 번 알린다.
    const payoutChanged =
      result.previous_payout_amount === null ||
      result.previous_payout_amount !== result.amounts.payout_amount
    if (payoutChanged) {
      notifySettlementPrepared(campaign, result.settlement as never, {
        revised: result.created === false,
      }).catch(e => log.error('정산 준비 알림 실패', e))
    }

    return ApiSuccess.ok({
      ...(await settlementPayload(campaign)),
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

    logUserActivity({
      user_id: auth.user.id,
      action_type: 'admin_action',
      target_type: 'funding_campaign',
      target_id: id,
      metadata: {
        action: 'settlement_paid',
        payout_amount: Number(result.settlement.payout_amount ?? 0),
      },
    }).catch(e => log.warn('활동 기록 실패', e))

    notifySettlementPaid(campaign, result.settlement as never).catch(e =>
      log.error('정산 지급 알림 실패', e)
    )

    return ApiSuccess.ok({
      ...(await settlementPayload(campaign)),
      campaign: { id: campaign.id, title: campaign.title, status: campaign.status },
    }).toNextResponse()
  } catch (error) {
    log.error('정산 지급 처리 실패:', error)
    return ApiError.internalServerError('지급을 기록하지 못했습니다.').toNextResponse()
  }
}
