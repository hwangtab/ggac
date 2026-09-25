import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { createCampaign, listCampaignsForAdmin, getCampaignProgress } from '@/db/queries/funding'
import { logUserActivity } from '@/db/queries/activities'
import { getProfileAuthzFields } from '@/db/queries/profiles'
import { parseCampaignPatch } from '@/lib/funding/campaignInput'
import { resolveApprovalSlug } from '@/lib/funding/approvalSlug'
import { proxyOwnerVerdict } from '@/lib/funding/proxyOwner'
import { feeRatesOf, getFundingSettings, isFundingEnabled } from '@/lib/funding/settings'
import { FUNDING_TERMS_REVISION } from '@/lib/funding/terms'
import { nextStatus, type CampaignStatus } from '@/lib/funding/transitions'
import { resolveCampaignFeeRate, type CampaignFeeRate } from '@/lib/server/fundingFeeRate'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/admin/funding/campaigns')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 승인 버튼을 누르면 수수료율이 캠페인에 **영원히** 새겨진다. 그것을 정산할
 * 때 처음 알게 두지 않으려고, 아직 승인할 수 있는 캠페인에는 "지금 누르면
 * 붙을 요율"을 함께 실어 보낸다(`fee_preview`).
 *
 * 승인할 수 없는 캠페인에는 싣지 않는다 — 이미 승인된 건은 캠페인 행에
 * 새겨진 값이 사실이고, 예고는 그 사실과 다를 수 있다.
 *
 * 나가는 것은 요율과 참·거짓 하나뿐이다. 개설자 프로필에서 읽은 값 자체는
 * 어느 것도 응답에 싣지 않는다.
 */
async function feePreviewFor(campaign: Record<string, unknown>): Promise<CampaignFeeRate | null> {
  if (!nextStatus(campaign.status as CampaignStatus, 'approve')) return null
  return resolveCampaignFeeRate(campaign.owner_user_id)
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const status = request.nextUrl.searchParams.get('status') ?? undefined
  const campaigns = await listCampaignsForAdmin({ status })
  const withProgress = await Promise.all(
    campaigns.map(async c => ({
      ...c,
      progress: await getCampaignProgress(String(c.id)),
      fee_preview: await feePreviewFor(c),
      // 승인할 수 있는 캠페인에만 싣는다 — 심사 화면이 주소 칸을 미리 채운다.
      slug_suggestion: nextStatus(c.status as CampaignStatus, 'approve')
        ? await resolveApprovalSlug(c)
        : null,
    }))
  )
  // 지금 설정에 들어 있는 두 요율. 심사 화면이 "조합원 3.3% / 비조합원
  // 5.5%"를 상수로 박아 두고 있었는데, 사무국이 설정에서 요율을 바꾸면 그
  // 문장만 옛 숫자로 남는다 — 화면에 적힌 값과 실제로 떼는 돈이 갈라진다.
  const rates = feeRatesOf(await getFundingSettings())
  return ApiSuccess.ok({ campaigns: withProgress, fee_rates: rates }).toNextResponse()
}

/**
 * 관리자 대리 개설. 사무국이 개설부터 승인까지 혼자 처리하는 경우를 위한 길이다
 * — 편집·리워드·표지·제출은 이미 관리자도 통과한다(`canManageCampaign`).
 *
 * 개설자 약관은 개설자가 화면에서 직접 누르지 않으므로, 관리자가 "개설자에게
 * 약관을 안내하고 동의를 받았다"고 확인해야만 만든다. 캠페인 행의 동의 기록
 * (`terms_version`·`terms_agreed_at`)은 그 확인 시점이고, **누가 대신 확인했는지**는
 * 활동 기록(`funding_campaign_created_by_admin`)에 관리자 계정으로 남는다.
 */
export async function POST(request: NextRequest) {
  // 대리 개설도 **개설**이다 — 스위치가 멈추라고 말한 동작이라 그대로 막는다.
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const body = await parseJsonObjectBody(request)
  if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
  if (body.agreedCreatorTermsOnBehalf !== true) {
    return ApiError.badRequest(
      '개설자에게 개설자 약관을 안내하고 동의를 받았는지 확인해 주세요.'
    ).toNextResponse()
  }

  const ownerUserId = typeof body.ownerUserId === 'string' ? body.ownerUserId.trim() : ''
  if (!ownerUserId) return ApiError.badRequest('개설자를 골라 주세요.').toNextResponse()
  const owner = proxyOwnerVerdict(await getProfileAuthzFields(ownerUserId))
  if (owner.ok === false) return ApiError.badRequest(owner.message).toNextResponse()

  const parsed = parseCampaignPatch(body, 'all')
  if (parsed.ok === false) return ApiError.badRequest(parsed.message).toNextResponse()
  const { patch } = parsed
  if (!patch.title || !patch.summary || !patch.goal_amount) {
    return ApiError.badRequest('제목·한 줄 소개·목표 금액은 필수입니다.').toNextResponse()
  }

  const campaign = await createCampaign({
    owner_user_id: ownerUserId,
    title: String(patch.title),
    summary: String(patch.summary),
    story: typeof patch.story === 'string' ? patch.story : '',
    category: typeof patch.category === 'string' ? patch.category : undefined,
    goal_amount: Number(patch.goal_amount),
    start_at: (patch.start_at as string | null) ?? null,
    end_at: (patch.end_at as string | null) ?? null,
    project_slug: (patch.project_slug as string | null) ?? null,
    terms_version: FUNDING_TERMS_REVISION,
  })
  logUserActivity({
    user_id: auth.user.id,
    action_type: 'funding_campaign_created_by_admin',
    target_type: 'funding_campaign',
    target_id: String(campaign.id),
    metadata: { owner_user_id: ownerUserId, owner_is_member: owner.is_member },
  }).catch(e => log.warn('활동 기록 실패', e))
  return ApiSuccess.created({ campaign }).toNextResponse()
}
