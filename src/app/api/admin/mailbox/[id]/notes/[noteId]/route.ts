import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { deleteNote, getNote, updateOwnNote } from '@/db/queries/mailboxNotes'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

import { readNoteBody } from '../noteBody'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function readIds(params: Record<string, unknown>): { emailId: string; noteId: string } {
  const email = validateUUID(String(params.id ?? ''), '메일 ID')
  const note = validateUUID(String(params.noteId ?? ''), '메모 ID')
  if (!email.isValid || !note.isValid) throw ApiError.badRequest('유효한 id가 필요합니다.')
  return { emailId: email.sanitized, noteId: note.sanitized }
}

/**
 * 쓰기가 막힌 이유를 가린다. 메모가 없거나 **경로의 메일 것이 아니면** 404(다른 메일의 메모 id를 섞는 시도 —
 * 첨부 다운로드와 같은 스코프 대조), 있는데 자격이 없으면 403.
 */
async function refusal(emailId: string, noteId: string): Promise<never> {
  const note = await getNote(noteId)
  if (!note || note.email_id !== emailId) throw ApiError.notFound('메모를 찾을 수 없습니다.')
  throw ApiError.forbidden('이 메모를 바꿀 권한이 없습니다.')
}

// 인가(`auth`)는 일부러 여기 두지 않고 각 라우트에 직접 적는다 — 게이트는 읽는 사람 눈에 바로 보여야 하고,
// `assert-runtime-risks.mjs`도 라우트 선언 안의 `auth:`를 본다.
const shared = {
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox_notes'),
  },
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('메모를 처리하는 중 오류가 발생했습니다.').toNextResponse()
  },
}

// PATCH: 메모 고치기 — 쓴 사람만(관리자도 남의 메모 내용은 바꾸지 않는다).
export const PATCH = defineApiRoute<{ body?: unknown }, BoardAuthSuccess>({
  method: 'PATCH',
  name: 'api/admin/mailbox/[id]/notes/[noteId]',
  auth: 'board-member',
  ...shared,
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  handler: async ({ body, params, auth }) => {
    const { emailId, noteId } = readIds(params)
    const text = readNoteBody(body?.body)
    const note = await updateOwnNote({
      id: noteId,
      email_id: emailId,
      author_id: auth.user.id,
      body: text,
    })
    if (!note) return refusal(emailId, noteId)
    return ApiSuccess.ok({ note })
  },
})

// DELETE: 메모 지우기 — 쓴 사람과 관리자.
export const DELETE = defineApiRoute<undefined, BoardAuthSuccess>({
  method: 'DELETE',
  name: 'api/admin/mailbox/[id]/notes/[noteId]',
  auth: 'board-member',
  ...shared,
  handler: async ({ params, auth }) => {
    const { emailId, noteId } = readIds(params)
    const deleted = await deleteNote({
      id: noteId,
      email_id: emailId,
      author_id: auth.isAdmin ? null : auth.user.id,
    })
    if (!deleted) return refusal(emailId, noteId)
    return ApiSuccess.ok({ id: noteId, deleted: true })
  },
})
