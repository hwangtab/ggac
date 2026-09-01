import { NextRequest, NextResponse } from 'next/server'
import { apiPatch, apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardDiscussionWriter } from '@/lib/server/boardRoomAuth'
import { MAX_AGENDA_COMMENT_LENGTH } from '@/constants/boardRoom'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import {
  getAgendaCommentOwner,
  softDeleteAgendaComment,
  updateAgendaCommentContent,
} from '@/db/queries/boardAgendaComments'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string; commentId: string }> }

function validateIds(id: string, commentId: string) {
  const agenda = validateUUID(id, '안건 ID')
  if (!agenda.isValid) {
    return { error: ApiError.badRequest(agenda.errors[0] || '잘못된 안건 ID 형식입니다.') }
  }
  const comment = validateUUID(commentId, '댓글 ID')
  if (!comment.isValid) {
    return { error: ApiError.badRequest(comment.errors[0] || '잘못된 댓글 ID 형식입니다.') }
  }
  return { agendaId: agenda.sanitized, commentId: comment.sanitized }
}

/**
 * 댓글이 경로의 안건에 실제로 속하는지까지 확인한다. 이 대조가 없으면
 * 아무 안건 id나 앞에 붙여 남의 안건 댓글을 건드릴 수 있다 — 속하지 않으면
 * 존재를 알리지 않기 위해 403이 아니라 404로 답한다.
 */
async function loadComment(commentId: string, agendaId: string) {
  const owner = await getAgendaCommentOwner(commentId)
  if (!owner || owner.agenda_id !== agendaId) {
    throw ApiError.notFound('의견을 찾을 수 없습니다.')
  }
  if (owner.is_deleted) throw ApiError.notFound('이미 삭제된 의견입니다.')
  return owner
}

export async function PATCH(request: NextRequest, context: RouteParams) {
  const params = await context.params
  const ids = validateIds(params.id, params.commentId)
  if (ids.error) return ids.error.toNextResponse()
  const { agendaId, commentId } = ids
  const auth = await requireBoardDiscussionWriter()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPatch(
    async () => {
      const owner = await loadComment(commentId, agendaId)
      // 수정은 본인만 한다. 관리자도 남의 발언을 고쳐 쓰지 못한다 —
      // 회의록 근거가 되는 기록이라 삭제(가림)까지가 관리자 권한의 끝이다.
      if (owner.author_id !== user.id) throw ApiError.forbidden('수정 권한이 없습니다.')

      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (!content) throw ApiError.badRequest('내용을 입력해 주세요.')
      if (content.length > MAX_AGENDA_COMMENT_LENGTH) {
        throw ApiError.badRequest(`내용은 ${MAX_AGENDA_COMMENT_LENGTH}자를 넘을 수 없습니다.`)
      }

      try {
        await updateAgendaCommentContent(commentId, content)
      } catch {
        throw ApiError.internalServerError('의견 수정에 실패했습니다.')
      }
      return ApiSuccess.ok({ id: commentId }, '의견이 수정되었습니다.')
    },
    `/api/board-room/agendas/${agendaId}/comments/${commentId}`,
    { userId: user.id }
  )
}

export async function DELETE(_request: NextRequest, context: RouteParams) {
  const params = await context.params
  const ids = validateIds(params.id, params.commentId)
  if (ids.error) return ids.error.toNextResponse()
  const { agendaId, commentId } = ids
  const auth = await requireBoardDiscussionWriter()
  if (auth instanceof NextResponse) return auth
  const { user, isAdmin } = auth

  return apiDelete(
    async () => {
      const owner = await loadComment(commentId, agendaId)
      if (owner.author_id !== user.id && !isAdmin) {
        throw ApiError.forbidden('삭제 권한이 없습니다.')
      }

      try {
        await softDeleteAgendaComment(commentId)
      } catch {
        throw ApiError.internalServerError('의견 삭제에 실패했습니다.')
      }
      return ApiSuccess.ok({ id: commentId }, '의견이 삭제되었습니다.')
    },
    `/api/board-room/agendas/${agendaId}/comments/${commentId}`,
    { userId: user.id }
  )
}
