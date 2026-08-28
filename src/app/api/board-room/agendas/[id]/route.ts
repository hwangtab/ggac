import { NextRequest, NextResponse } from 'next/server'
import { apiPatch, apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { BOARD_AGENDA_STATUS, parseBoardAgendaSortOrder } from '@/constants/boardRoom'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { deleteAgenda, getAgendaOwner, updateAgenda } from '@/db/queries/board'
import { hasLiveComments } from '@/db/queries/boardAgendaComments'

export const runtime = 'nodejs'

function validateAgendaId(id: string) {
  const validation = validateUUID(id, '안건 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 안건 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const routeId = validateAgendaId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user, isAdmin } = auth

  return apiPatch(
    async () => {
      const owner = await getAgendaOwner(id)
      if (owner === undefined) throw ApiError.notFound('안건을 찾을 수 없습니다.')
      if (owner !== user.id && !isAdmin) {
        throw ApiError.forbidden('수정 권한이 없습니다.')
      }

      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const update: {
        title?: string
        content?: string | null
        status?: string
        sortOrder?: number
      } = {}
      if (typeof body.title === 'string') update.title = body.title.trim()
      if (body.content === null || typeof body.content === 'string')
        update.content = body.content as string | null
      if (typeof body.status === 'string') {
        if (!(BOARD_AGENDA_STATUS as readonly string[]).includes(body.status))
          throw ApiError.badRequest('잘못된 상태값입니다.')
        update.status = body.status
      }
      if (body.sort_order !== undefined) {
        const sortOrder = parseBoardAgendaSortOrder(body.sort_order)
        if (sortOrder === null) throw ApiError.badRequest('안건 순서값이 올바르지 않습니다.')
        update.sortOrder = sortOrder
      }
      if (Object.keys(update).length === 0) throw ApiError.badRequest('변경할 내용이 없습니다.')

      try {
        await updateAgenda(id, update)
      } catch {
        throw ApiError.internalServerError('안건 수정에 실패했습니다.')
      }
      return ApiSuccess.ok({ id }, '안건이 수정되었습니다.')
    },
    `/api/board-room/agendas/${id}`,
    { userId: user.id }
  )
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const routeId = validateAgendaId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user, isAdmin } = auth

  return apiDelete(
    async () => {
      const owner = await getAgendaOwner(id)
      if (owner === undefined) throw ApiError.notFound('안건을 찾을 수 없습니다.')
      if (owner !== user.id && !isAdmin) {
        throw ApiError.forbidden('삭제 권한이 없습니다.')
      }

      // 안건 삭제는 hard DELETE고 `board_agenda_comments`가 cascade로 딸려
      // 간다 — 제안자 한 사람이 다른 이사들의 발언을 **행째로** 없앨 수 있다.
      // 그건 댓글 DELETE가 관리자에게조차 금지한 일이다(그쪽은 soft delete만
      // 한다). 그래서 토론이 붙은 안건은 관리자만 지운다.
      if (!isAdmin && (await hasLiveComments(id))) {
        throw ApiError.forbidden('토론이 진행된 안건은 관리자만 삭제할 수 있습니다.')
      }

      try {
        await deleteAgenda(id)
      } catch {
        throw ApiError.internalServerError('안건 삭제에 실패했습니다.')
      }
      return ApiSuccess.ok({ id }, '안건이 삭제되었습니다.')
    },
    `/api/board-room/agendas/${id}`,
    { userId: user.id }
  )
}
