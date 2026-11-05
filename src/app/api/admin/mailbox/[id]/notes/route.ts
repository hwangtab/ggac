import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { getInboundEmail } from '@/db/queries/mailbox'
import { insertNote } from '@/db/queries/mailboxNotes'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

import { readNoteBody } from './noteBody'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST: 받은 메일에 내부 메모를 남긴다 — 이사·감사·관리자 전원(2026-11-05 결정). 메모는 메일로 나가지 않는다.
export const POST = defineApiRoute<{ body?: unknown }, BoardAuthSuccess>({
  method: 'POST',
  name: 'api/admin/mailbox/[id]/notes',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox_notes'),
  },
  auth: 'board-member',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('메모를 저장하는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ body, params, auth }) => {
    const idCheck = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idCheck.isValid) throw ApiError.badRequest('유효한 id가 필요합니다.')
    const text = readNoteBody(body?.body)
    if (!(await getInboundEmail(idCheck.sanitized))) {
      throw ApiError.notFound('메일을 찾을 수 없습니다.')
    }
    const note = await insertNote({
      email_id: idCheck.sanitized,
      author_id: auth.user.id,
      body: text,
    })
    return ApiSuccess.created({ note })
  },
})
