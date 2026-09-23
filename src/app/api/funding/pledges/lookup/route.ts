import { NextRequest } from 'next/server'

import { getOptionalUser } from '@/lib/server/memberAuth'
import { getCampaignById } from '@/db/queries/funding'
import { getPledgeByCodeAndEmail } from '@/db/queries/fundingPledges'
import { canViewPledge } from '@/lib/server/fundingAuth'
import { isPledgeCode } from '@/lib/funding/pledgeCode'
import { toPublicPledgeFields } from '@/lib/funding/pledgeView'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/funding/pledges/lookup')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 후원자에게 보여줄 필드만. 배송지·전화·관리자 메모는 내보내지 않는다. */
function publicView(pledge: Record<string, unknown>, campaign: Record<string, unknown> | null) {
  return {
    ...toPublicPledgeFields(pledge),
    campaign_slug: campaign?.slug ?? null,
    campaign_title: campaign?.title ?? null,
    campaign_status: campaign?.status ?? null,
    // 취소 라우트의 재시도 판정과 정확히 같은 조건(`isRetry`)이다 — 결제
    // 식별자 자체는 내보내지 않고, "재시도가 가능한가"라는 불리언만 준다.
    refund_retry_possible: pledge.status === 'canceled' && Boolean(pledge.payment_id),
  }
}

export async function POST(request: NextRequest) {
  try {
    const rl = await applyRouteRateLimit(request, {
      name: 'funding_lookup',
      windowMs: 60_000,
      maxRequests: 10,
      message: '요청이 너무 잦습니다.',
      keyGenerator: createIPKeyGenerator('funding-lookup'),
    })
    if (!rl.success && rl.response?.status === 429) return rl.response

    const body = await parseJsonObjectBody(request)
    if (!body || !isPledgeCode(body.pledgeCode) || typeof body.email !== 'string') {
      return ApiError.badRequest('후원번호와 이메일을 입력해 주세요.').toNextResponse()
    }
    const found = await getPledgeByCodeAndEmail(body.pledgeCode, body.email.trim())
    // 취소 라우트와 **같은 규칙**이다. 번호+이메일은 인증할 수 없는 사람을
    // 위한 길이지, 인증할 수 있는 사람에게 열린 두 번째 문이 아니다 —
    // 임자(`user_id`)가 있는 후원은 세션이 그 임자일 때만 지나고, 임자가 없는
    // 비회원 후원은 그대로 지난다. 조회가 내보내는 값은 개인정보를 덜어낸
    // 것뿐이라 노출 자체는 작지만, 같은 규칙을 한쪽에만 적어 두면 갈라진다.
    // 취소를 고칠 때 이 파일을 함께 고쳐야 한다.
    const owned = (found as { user_id: string | null } | null)?.user_id ?? null
    const user = owned === null ? null : await getOptionalUser()
    const pledge =
      found && (owned === null || canViewPledge(user?.id ?? null, { user_id: owned }))
        ? found
        : null
    // 못 찾음과 남의 것을 구분하지 않는다 — 번호 존재 여부가 새면 추측이 쉬워진다.
    if (!pledge) return ApiError.notFound('후원 내역을 찾을 수 없습니다.').toNextResponse()
    const campaign = await getCampaignById(String(pledge.campaign_id))
    return ApiSuccess.ok({ pledge: publicView(pledge, campaign) }).toNextResponse()
  } catch (error) {
    log.error('후원 조회 실패:', error)
    return ApiError.internalServerError('후원 내역을 조회하지 못했습니다.').toNextResponse()
  }
}
