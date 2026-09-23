/**
 * 리워드 일괄 저장. draft에서는 자유, active에서는 추가와 수량 증가만.
 * 잠긴 리워드는 `evaluateRewardPatch`가 판정하고, 관리자도 예외가 없다.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import {
  getCampaignById,
  listRewards,
  createReward,
  updateReward,
  deleteReward,
} from '@/db/queries/funding'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { editScope, type CampaignStatus } from '@/lib/funding/transitions'
import { parseRewardList } from '@/lib/funding/campaignInput'
import { evaluateRewardPatch, canDeleteReward } from '@/lib/funding/rewardLock'
import { isFundingEnabled } from '@/lib/funding/settings'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOCK_MESSAGES = {
  locked_amount: '결제가 있는 리워드의 금액은 바꿀 수 없습니다. 새 리워드를 추가해 주세요.',
  locked_shipping: '결제가 있는 리워드의 배송 여부는 바꿀 수 없습니다.',
  quantity_decrease: '결제가 있는 리워드의 수량은 늘릴 수만 있습니다.',
  content_only_field:
    '공개된 프로젝트에서는 기존 리워드의 이름·설명·금액·배송 여부를 바꿀 수 없습니다. 새 리워드를 추가해 주세요.',
  content_only_quantity_decrease:
    '공개된 프로젝트에서는 기존 리워드의 수량을 줄일 수 없습니다. 늘리는 것만 됩니다.',
} as const

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const campaign = await getCampaignById(id)
  if (
    !campaign ||
    !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }
  const scope = editScope(campaign.status as CampaignStatus)
  if (scope === 'none')
    return ApiError.badRequest('지금 상태에서는 수정할 수 없습니다.').toNextResponse()

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
      {
        title: String(cur.title),
        description: (cur.description as string | null) ?? null,
        amount: Number(cur.amount),
        requires_shipping: Boolean(cur.requires_shipping),
        total_quantity: (cur.total_quantity as number | null) ?? null,
        locked_at: (cur.locked_at as string | null) ?? null,
      },
      {
        title: r.title,
        description: r.description,
        amount: r.amount,
        requires_shipping: r.requires_shipping,
        total_quantity: r.total_quantity,
      },
      scope
    )
    if (verdict.ok === false)
      return ApiError.badRequest(LOCK_MESSAGES[verdict.reason]).toNextResponse()
  }
  for (const cur of existing) {
    if (incomingIds.has(String(cur.id))) continue
    if (!canDeleteReward({ locked_at: (cur.locked_at as string | null) ?? null })) {
      return ApiError.badRequest(
        `'${cur.title}'은 결제가 있어 삭제할 수 없습니다.`
      ).toNextResponse()
    }
    if (scope === 'contentOnly')
      return ApiError.badRequest(
        '공개된 프로젝트에서는 리워드를 삭제할 수 없습니다.'
      ).toNextResponse()
  }

  // 검증(위)은 all-or-nothing이다 — 하나라도 거절되면 이 아래는 아무것도
  // 실행되지 않는다. 하지만 여기서부터는 트랜잭션이 아니다. DB 오류가 중간에
  // 나면 이미 실행된 쓰기는 되돌리지 않는다. 그래서 생성·수정을 먼저 하고
  // 삭제를 맨 마지막에 둔다 — 실패해도 "지우려던 게 아직 남은" 상태(다시
  // 저장하면 회복된다)로 남지, "있던 리워드가 사라진" 상태로는 남지 않는다.
  for (const r of parsed.rewards) {
    if (!r.id) {
      await createReward({ campaign_id: id, ...r })
      continue
    }
    const cur = byId.get(r.id)
    // 검증 시점엔 잠기지 않았더라도, 검증과 이 쓰기 사이에 결제가 확정돼
    // 잠길 수 있다(가격이 바뀐 뒤 결제한 사람이 생기는 것을 막으려는 게 잠금의
    // 목적이므로, 검증 한 번으로는 부족하다). 금액·배송 여부가 바뀌는
    // 갱신은 DB에 "여전히 안 잠겨 있을 때만" 조건을 걸어 마지막 방어선을 둔다.
    const changesLockedFields =
      cur !== undefined &&
      (r.amount !== Number(cur.amount) || r.requires_shipping !== Boolean(cur.requires_shipping))
    const wasUnlocked = !cur?.locked_at
    const result = await updateReward(r.id, r, {
      requireUnlocked: wasUnlocked && changesLockedFields,
    })
    if (!result.changed) {
      return ApiError.conflict(
        `'${cur?.title ?? r.title}' 리워드에 방금 후원이 들어왔습니다. 새로고침한 뒤 다시 시도해 주세요.`
      ).toNextResponse()
    }
  }
  for (const cur of existing)
    if (!incomingIds.has(String(cur.id))) await deleteReward(String(cur.id))
  return ApiSuccess.ok({ rewards: await listRewards(id) }).toNextResponse()
}
