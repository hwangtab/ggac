import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { logSecurityEvent } from '@/utils/security'
import { findMemberByEmail, getSenderSummary } from '@/db/queries/mailbox'
import { parseMailbox } from '@/lib/mail/senderAddress'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET: 발신자 카드 — 이 주소에서 몇 통 왔고 우리가 몇 번 답했는지, 가입한 회원인지.
 *
 * 열람은 목록과 같은 `board-member`(이사·감사·관리자)다. 회원 매칭(`member`)도 같은 범위에 내려간다 —
 * 이사·감사에게도 보이기로 했다(2026-11-05 결정). 명부의 일부이므로 **배지가 그리는 칸(이름·가입 상태·활성)만**
 * 싣는다. 회원 id·연락처·계좌는 싣지 않는다 — 범위를 넓힐 때 칸까지 넓어지지 않게 여기서 고른다.
 */
export const GET = defineApiRoute<undefined, BoardAuthSuccess>({
  method: 'GET',
  name: 'api/admin/mailbox/sender',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  rateLimitHeaders: true,
  auth: 'board-member',
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError(
      '발신자 정보를 불러오는 중 오류가 발생했습니다.'
    ).toNextResponse()
  },
  handler: async ({ request }) => {
    const raw = request.nextUrl.searchParams.get('email')?.trim()
    const email = raw ? parseMailbox(raw.slice(0, 320)).email : ''
    if (!email || email.length > 254) {
      throw ApiError.badRequest('보낸 사람 주소가 올바르지 않습니다.')
    }

    const [sender, found] = await Promise.all([getSenderSummary(email), findMemberByEmail(email)])
    const member = found
      ? {
          display_name: found.display_name,
          registration_status: found.registration_status,
          is_active: found.is_active,
        }
      : null
    return ApiSuccess.ok({ sender, member })
  },
})
