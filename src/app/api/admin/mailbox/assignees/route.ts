import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { canAccessBoardRoom } from '@/lib/server/authz'
import { listWorkPeople } from '@/db/queries/work/directory'
import { logSecurityEvent } from '@/utils/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET: 담당자 후보 — **지금** 이사·감사·관리자인 승인·활성 회원(`canAccessBoardRoom`). 지정은 관리자만 하므로 후보
 * 목록도 관리자에게만 준다. 이름과 역할만 싣는다(연락처는 `listWorkPeople`이 애초에 읽지 않는다).
 */
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/mailbox/assignees',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  auth: 'admin',
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('담당자 후보를 불러오지 못했습니다.').toNextResponse()
  },
  handler: async () => {
    const people = (await listWorkPeople()).filter(person => canAccessBoardRoom(person))
    return ApiSuccess.ok({
      assignees: people.map(person => ({
        id: person.user_id,
        display_name: person.display_name,
        role: person.is_admin ? 'admin' : person.is_director ? 'director' : 'auditor',
      })),
    })
  },
})
