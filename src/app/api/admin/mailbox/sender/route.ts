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
 * GET: 발신자 카드 — 이 주소에서 몇 통 왔고 우리가 몇 번 답했는지.
 *
 * 열람은 목록과 같은 `board-member`(이사·감사·관리자)다. 다만 **회원 매칭(`member`)은 관리자에게만**
 * 내려간다 — 이 주소가 어느 회원인지는 회원 명부의 일부라 메일함 열람 권한과 별개다. 이사·감사 응답에는
 * `member` 키 자체가 없다(값을 null로 두면 "회원이 아니다"로 읽혀 그것도 정보가 된다).
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
  handler: async ({ request, auth }) => {
    const raw = request.nextUrl.searchParams.get('email')?.trim()
    const email = raw ? parseMailbox(raw.slice(0, 320)).email : ''
    if (!email || email.length > 254) {
      throw ApiError.badRequest('보낸 사람 주소가 올바르지 않습니다.')
    }

    const sender = await getSenderSummary(email)
    if (!auth.isAdmin) {
      return ApiSuccess.ok({ sender })
    }
    const member = await findMemberByEmail(email)
    return ApiSuccess.ok({ sender, member })
  },
})
