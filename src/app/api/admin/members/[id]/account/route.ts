/**
 * 조합원 한 사람의 계좌 — 사무국(관리자) 전용, 그리고 **달라고 했을 때만.**
 *
 * 조합원 목록(`/api/admin/members`)은 계좌를 싣지 않는다. 예전에는 실었고,
 * 그래서 관리자가 조합원 관리를 한 번 여는 것만으로 전 조합원의 계좌번호가
 * 브라우저에 깔렸다 — 아무도 특정인의 계좌를 보려던 것이 아니었고, 누가 언제
 * 무엇을 봤는지 답할 자료도 남지 않았다.
 *
 * 계좌가 필요한 순간은 하나다 — **한 사람에게 돈을 보내거나 조합비를 맞춰
 * 보려고 그 사람을 열어 볼 때.** 그 한 건을 여기서 처리한다.
 *
 * 모양은 정산 패널의 입금 계좌 조회(`/api/admin/funding/campaigns/[id]/
 * settlement?account=1`)·배송 목록 내보내기와 같다.
 *
 * - 게이트는 화면이 아니라 서버다(`requireAdmin`).
 * - 값을 내보내기 **전에 기다려** 활동 기록을 남긴다. 응답 뒤로 미루면
 *   서버리스 함수가 얼어붙어 기록이 통째로 사라질 수 있고, 그러면 남의
 *   계좌번호가 흔적 없이 나간다.
 * - 접속 주소와 브라우저를 함께 남긴다. 기록이 실패하면 보안 이벤트로
 *   올리되 조회 자체는 막지 않는다 — 정당한 업무다.
 * - **기록에 계좌는 넣지 않는다.** 활동 기록은 관리자 화면에 그대로 보이므로,
 *   넣으면 방금 좁혀 둔 경계 밖으로 값이 한 번 더 샌다.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { applyRouteRateLimit } from '@/lib/server/rateLimit'
import {
  ACCOUNT_REVEAL_RATE_LIMIT,
  accountRevealRateLimitKey,
} from '@/lib/server/accountRevealLimit'
import { logUserActivity } from '@/db/queries/activities'
import { getPayoutAccount } from '@/db/queries/profiles'
import { isPayoutAccountRegistered, type PayoutAccount } from '@/lib/funding/payoutAccount'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/admin/members/account')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

async function recordAccountView(
  request: NextRequest,
  adminUserId: string,
  memberId: string,
  account: PayoutAccount | null
) {
  try {
    await logUserActivity({
      user_id: adminUserId,
      action_type: 'member_account_viewed',
      target_type: 'profile',
      target_id: memberId,
      metadata: { bank_account_registered: isPayoutAccountRegistered(account) },
      ip_address:
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
      user_agent: request.headers.get('user-agent') || null,
    })
  } catch (logError) {
    logSecurityEvent(
      'MEMBER_ACCOUNT_VIEW_AUDIT_FAILED',
      {
        memberId,
        error: logError instanceof Error ? logError.message : String(logError),
      },
      'high'
    )
    log.error('조합원 계좌 조회 기록 실패', {
      memberId,
      error: logError instanceof Error ? logError.message : String(logError),
    })
  }
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  // 기록만으로는 한 세션이 전 조합원을 훑는 것을 늦추지 못한다 — 아무도 보지
  // 않는 기록은 제한이 아니다. 정산 패널의 계좌 노출과 **같은 카운터**를 쓴다
  // (`src/lib/server/accountRevealLimit.ts`에 숫자와 이유가 함께 있다).
  // 인가를 통과한 뒤에 센다: 세는 단위가 IP가 아니라 관리자 한 사람이다.
  const rl = await applyRouteRateLimit(request, {
    ...ACCOUNT_REVEAL_RATE_LIMIT,
    keyGenerator: () => accountRevealRateLimitKey(auth.user.id),
  })
  if (rl.success === false && rl.response) return rl.response

  try {
    const account = await getPayoutAccount(id)
    if (account === null) {
      // 없는 사람의 계좌를 봤다고 기록하지 않는다 — 기록은 실제로 값이
      // 나간 건만 담아야 세는 의미가 있다.
      return ApiError.notFound('조합원을 찾을 수 없습니다.').toNextResponse()
    }
    await recordAccountView(request, auth.user.id, id, account)
    // 응답 캐시는 `ApiSuccess`의 기본값(`private, no-store`)이다.
    return ApiSuccess.ok({
      account,
      bank_account_registered: isPayoutAccountRegistered(account),
    }).toNextResponse()
  } catch (error) {
    log.error('조합원 계좌 조회 실패:', error)
    return ApiError.internalServerError('계좌 정보를 불러오지 못했습니다.').toNextResponse()
  }
}
