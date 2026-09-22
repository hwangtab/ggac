/**
 * 리워드 일괄 저장. draft에서는 자유, active에서는 추가와 수량 증가만.
 * 잠긴 리워드는 `evaluateRewardPatch`가 판정하고, 관리자도 예외가 없다.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getCampaignById, listRewards, createReward, updateReward, deleteReward } from '@/db/queries/funding'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { editScope, type CampaignStatus } from '@/lib/funding/transitions'
import { parseRewardList } from '@/lib/funding/campaignInput'
import { evaluateRewardPatch, canDeleteReward } from '@/lib/funding/rewardLock'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOCK_MESSAGES = {
  locked_amount: '결제가 있는 리워드의 금액은 바꿀 수 없습니다. 새 리워드를 추가해 주세요.',
  locked_shipping: '결제가 있는 리워드의 배송 여부는 바꿀 수 없습니다.',
  quantity_decrease: '결제가 있는 리워드의 수량은 늘릴 수만 있습니다.',
} as const

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const campaign = await getCampaignById(id)
  if (!campaign || !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const scope = editScope(campaign.status as CampaignStatus)
  if (scope === 'none') return ApiError.badRequest('지금 상태에서는 수정할 수 없습니다.').toNextResponse()

  const body = await request.json().catch(() => null)
  const parsed = parseRewardList(body?.rewards)
  if (parsed.ok === false) return ApiError.badRequest(parsed.message).toNextResponse()

  const existing = await listRewards(id)
  const byId = new Map(existing.map(r => [String(r.id), r]))
  const incomingIds = new Set(parsed.rewards.filter(r => r.id).map(r => r.id as string))

  // 1) 검증을 전부 끝낸 뒤 2) 쓴다 — 중간에 거절되면 반쪽 상태가 남는다.
  for (const r of parsed.rewards) {
    if (!r.id) continue
    const cur = byId.get(r.id)
    if (!cur) return ApiError.badRequest('없는 리워드를 수정하려 합니다.').toNextResponse()
    const verdict = evaluateRewardPatch(
      { amount: Number(cur.amount), requires_shipping: Boolean(cur.requires_shipping), total_quantity: (cur.total_quantity as number | null) ?? null, locked_at: (cur.locked_at as string | null) ?? null },
      { amount: r.amount, requires_shipping: r.requires_shipping, total_quantity: r.total_quantity }
    )
    if (verdict.ok === false) return ApiError.badRequest(LOCK_MESSAGES[verdict.reason]).toNextResponse()
  }
  for (const cur of existing) {
    if (incomingIds.has(String(cur.id))) continue
    if (!canDeleteReward({ locked_at: (cur.locked_at as string | null) ?? null })) {
      return ApiError.badRequest(`'${cur.title}'은 결제가 있어 삭제할 수 없습니다.`).toNextResponse()
    }
    if (scope === 'contentOnly') return ApiError.badRequest('공개된 프로젝트에서는 리워드를 삭제할 수 없습니다.').toNextResponse()
  }

  for (const cur of existing) if (!incomingIds.has(String(cur.id))) await deleteReward(String(cur.id))
  for (const r of parsed.rewards) {
    if (r.id) await updateReward(r.id, r)
    else await createReward({ campaign_id: id, ...r })
  }
  return ApiSuccess.ok({ rewards: await listRewards(id) }).toNextResponse()
}
