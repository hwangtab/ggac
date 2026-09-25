/**
 * 결제 단계에서 **돌아가기** — 아직 결제가 붙지 않은 자기 선점을 놓아 준다.
 *
 * 무엇이 통과하고 왜 그 선이 거기인지는 `@/lib/funding/pledgeRelease`에 있다.
 * 이 파일은 그 판정을 원장 한 행에 적용하고, 조건부 UPDATE의 0행을 409로
 * 답하는 것뿐이다 — 읽은 뒤 쓰기 사이에 상태가 움직이는 자리라, 이 기능의
 * 다른 자리들과 같은 모양을 쓴다.
 *
 * 놓아 준 선점은 상한 셈에서 곧바로 빠진다(`ownHoldCondition`이 `pending`만
 * 센다). 그래서 리워드를 고쳐 고르는 것이 상한을 깎아먹지 않는다.
 */
import { NextRequest } from 'next/server'

import { getOptionalUser } from '@/lib/server/memberAuth'
import { cancelPendingPledge, getPledgeById } from '@/db/queries/fundingPledges'
import { planPledgeRelease } from '@/lib/funding/pledgeRelease'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { ApiSuccess, ApiError, withApiWrapper } from '@/utils/apiWrapper'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const rl = await applyRouteRateLimit(request, {
    name: 'funding_release',
    windowMs: 60_000,
    maxRequests: 20,
    message: '요청이 너무 잦습니다.',
    keyGenerator: createIPKeyGenerator('funding-release'),
  })
  if (!rl.success && rl.response?.status === 429) return rl.response

  return withApiWrapper(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
      const pledgeId = typeof body.pledgeId === 'string' ? body.pledgeId : ''
      const orderId = typeof body.orderId === 'string' ? body.orderId : ''
      if (pledgeId.length === 0 || orderId.length === 0)
        throw ApiError.badRequest('후원 정보가 없습니다.')

      const user = await getOptionalUser()
      const pledge = await getPledgeById(pledgeId)
      const plan = planPledgeRelease(pledge, { userId: user?.id ?? null, orderId })
      if (plan.ok === false) {
        if (plan.status === 404) throw ApiError.notFound(plan.message)
        throw ApiError.conflict(plan.message)
      }

      // 상태를 읽고 나서 쓰지 않는다 — 조건(`status='pending'` + 주문 짝)은
      // UPDATE의 WHERE에 있다. 0행이면 그사이 움직인 것이다.
      const canceled = await cancelPendingPledge(pledgeId, orderId)
      if (!canceled)
        throw ApiError.conflict('이미 정리된 결제 대기입니다. 처음부터 다시 골라 주세요.')

      return ApiSuccess.ok({ released: true })
    },
    { endpoint: '/api/funding/pledges/release', method: 'POST' }
  )
}
