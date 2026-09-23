/**
 * 리워드 일괄 저장. draft에서는 자유, active에서는 추가와 수량 증가만.
 * 잠긴 리워드는 `evaluateRewardPatch`가 판정하고, 관리자도 예외가 없다.
 */
import { NextRequest, NextResponse, after } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getCampaignById, listRewards, applyRewardBatch } from '@/db/queries/funding'
import { isLockContention } from '@/db/queries/_helpers'
import { logUserActivity } from '@/db/queries/activities'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { editScope, type CampaignStatus } from '@/lib/funding/transitions'
import { parseRewardList } from '@/lib/funding/campaignInput'
import {
  evaluateRewardPatch,
  canDeleteReward,
  deliveryChangesToLog,
} from '@/lib/funding/rewardLock'
import { notifyRewardDeliveryChanged } from '@/lib/funding/notify'
import { isFundingEnabled } from '@/lib/funding/settings'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/funding/rewards')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOCK_MESSAGES = {
  locked_amount: '결제가 있는 리워드의 금액은 바꿀 수 없습니다. 새 리워드를 추가해 주세요.',
  locked_shipping: '결제가 있는 리워드의 배송 여부는 바꿀 수 없습니다.',
  quantity_decrease: '결제가 있는 리워드의 수량은 늘릴 수만 있습니다.',
  content_only_field:
    '공개된 프로젝트에서는 기존 리워드의 이름·설명·금액·배송 여부를 바꿀 수 없습니다. 새 리워드를 추가해 주세요.',
  content_only_image:
    '공개된 프로젝트에서는 기존 리워드의 사진을 바꿀 수 없습니다. 사진은 후원자가 보고 고른 내용의 일부입니다. 꼭 바꿔야 하면 사무국에 문의해 주세요.',
  content_only_quantity_decrease:
    '공개된 프로젝트에서는 기존 리워드의 수량을 줄일 수 없습니다. 늘리는 것만 됩니다.',
} as const

/**
 * 라우트 전체를 감싼다. 안쪽에서 던진 예외가 그대로 빠져나가면 Next가 본문
 * 없는 500을 돌려주고, 개설자는 리워드를 한참 고쳐 넣은 화면에서 아무 문장도
 * 못 받는다. 특히 `applyRewardBatch`는 이 앱에서 쓰기 잠금을 가장 오래 쥐는
 * 트랜잭션이라 `SQLITE_BUSY`가 실제로 여기까지 올라온다(쿼리 계층이 네 번
 * 다시 해 본 뒤다). 그 경우와 나머지는 개설자가 할 일이 다르므로 문장을 나눈다.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await handlePut(request, params)
  } catch (error) {
    log.error('리워드 저장 실패:', error)
    if (isLockContention(error)) {
      return ApiError.serviceUnavailable(
        '지금 저장 요청이 몰려 리워드를 저장하지 못했습니다. 입력하신 내용은 그대로 남아 있으니 30초쯤 뒤에 저장을 한 번 더 눌러 주세요.'
      ).toNextResponse()
    }
    return ApiError.internalServerError(
      '리워드를 저장하지 못했습니다. 입력하신 내용은 그대로 남아 있으니 잠시 뒤에 다시 저장해 주세요. 계속 같은 화면이 나오면 사무국(contact@ggac.kr)으로 알려 주시면 확인해 드리겠습니다.'
    ).toNextResponse()
  }
}

async function handlePut(request: NextRequest, params: Promise<{ id: string }>) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  // 본문을 **먼저** 끝까지 읽는다. 상태를 읽고 편집 범위를 정한 뒤에 읽으면,
  // 본문이 도착하는 시점을 요청자가 쥐고 있으므로 그 사이에 제출·승인이 끼어들
  // 수 있다 — 그러면 낡은 범위로 검증하게 된다(전이 라우트와 같은 순서다).
  const body = await request.json().catch(() => null)

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
        image_url: (cur.image_url as string | null) ?? null,
        locked_at: (cur.locked_at as string | null) ?? null,
      },
      {
        title: r.title,
        description: r.description,
        amount: r.amount,
        requires_shipping: r.requires_shipping,
        total_quantity: r.total_quantity,
        image_url: r.image_url,
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
  // 실행되지 않는다. 쓰기는 `applyRewardBatch`가 한 트랜잭션으로 묶는다:
  // 맨 앞에서 판정 근거가 된 상태(`status`)를 조건부로 다시 확인하고, 생성·
  // 수정·삭제 중 하나라도 거절되면 통째로 되감는다. 문장이 여럿이라 첫 문장
  // 앞에서 한 번 확인하는 것만으로는 뒤 문장이 지켜지지 않는다.
  const creates = parsed.rewards.filter(r => !r.id).map(r => ({ campaign_id: id, ...r }))
  const updates = parsed.rewards
    .filter(r => r.id)
    .map(r => {
      const cur = byId.get(r.id as string)
      // 검증 시점엔 잠기지 않았더라도, 검증과 쓰기 사이에 결제가 확정돼 잠길 수
      // 있다(가격이 바뀐 뒤 결제한 사람이 생기는 것을 막으려는 게 잠금의
      // 목적이므로, 검증 한 번으로는 부족하다). 금액·배송 여부가 바뀌는 갱신은
      // DB에 "여전히 안 잠겨 있을 때만" 조건을 걸어 마지막 방어선을 둔다.
      const changesLockedFields =
        cur !== undefined &&
        (r.amount !== Number(cur.amount) || r.requires_shipping !== Boolean(cur.requires_shipping))
      return {
        id: r.id as string,
        patch: r,
        require_unlocked: !cur?.locked_at && changesLockedFields,
      }
    })
  const delete_ids = existing.filter(c => !incomingIds.has(String(c.id))).map(c => String(c.id))

  const result = await applyRewardBatch({
    campaign_id: id,
    expected_status: status,
    creates,
    updates,
    delete_ids,
  })
  if (result.ok === false) {
    if (result.reason === 'status_changed') {
      return ApiError.conflict('상태가 이미 바뀌었습니다. 새로고침해 주세요.').toNextResponse()
    }
    const title = byId.get(result.reward_id)?.title ?? '리워드'
    return ApiError.conflict(
      `'${title}' 리워드에 방금 후원이 들어왔습니다. 새로고침한 뒤 다시 시도해 주세요.`
    ).toNextResponse()
  }
  // 예상 전달월(`estimated_delivery`)은 잠그지 않는다 — 약관 제12조가 전달
  // 지연을 "알린다"로 정할 뿐 날짜를 얼리지 않기 때문이다(근거는
  // `@/lib/funding/rewardLock`의 머리 주석). 대신 조용히 바뀌지는 않게,
  // 바뀐 리워드의 이전 값과 새 값을 활동 로그에 남기고, 그 리워드를 후원한
  // 사람들에게 알린다(약관 제12조 — 발송이 늦어지면 창작자가 알린다).
  const deliveryChanges = deliveryChangesToLog(
    existing.map(r => ({
      id: String(r.id),
      title: String(r.title),
      estimated_delivery: (r.estimated_delivery as string | null) ?? null,
    })),
    parsed.rewards
  )
  if (deliveryChanges.length > 0) {
    logUserActivity({
      user_id: auth.user.id,
      action_type: 'funding_reward_delivery_changed',
      target_type: 'funding_campaign',
      target_id: id,
      metadata: { campaign_status: status, changes: deliveryChanges },
    }).catch(e => log.warn('예상 전달월 변경 기록 실패', e))
    // 후원자 수가 얼마든 응답을 기다리게 하지 않는다. `notifyRewardDeliveryChanged`는
    // 스스로 던지지 않지만, `after()` 안에서 새는 예외는 잡아 줄 사람이 없으므로
    // 다른 알림 호출부와 같은 모양으로 한 번 더 감싼다.
    after(() =>
      notifyRewardDeliveryChanged(campaign, deliveryChanges).catch(e =>
        log.error('예상 전달월 변경 알림 실패', e)
      )
    )
  }

  return ApiSuccess.ok({ rewards: await listRewards(id) }).toNextResponse()
}
