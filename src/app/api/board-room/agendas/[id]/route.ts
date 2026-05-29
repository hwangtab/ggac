import { NextRequest, NextResponse } from 'next/server'
import { apiPatch, apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { BOARD_AGENDA_STATUS } from '@/constants/boardRoom'

export const runtime = 'nodejs'

async function loadAgendaOwner(db: any, id: string) {
  const { data, error } = await db.from('board_agendas').select('proposed_by').eq('id', id).single()
  if (error) return { error }
  return { owner: data?.proposed_by as string | undefined }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user, isAdmin } = auth

  return apiPatch(
    async () => {
      const { owner, error: ownerErr } = await loadAgendaOwner(db, id)
      if (ownerErr || owner === undefined) throw ApiError.notFound('안건을 찾을 수 없습니다.')
      if (owner !== user.id && !isAdmin) throw ApiError.forbidden('수정 권한이 없습니다.')

      const body = await request.json()
      const update: Record<string, unknown> = {}
      if (typeof body.title === 'string') update.title = body.title.trim()
      if (body.content === null || typeof body.content === 'string') update.content = body.content
      if (typeof body.status === 'string') {
        if (!(BOARD_AGENDA_STATUS as readonly string[]).includes(body.status))
          throw ApiError.badRequest('잘못된 상태값입니다.')
        update.status = body.status
      }
      if (typeof body.sort_order === 'number') update.sort_order = body.sort_order
      if (Object.keys(update).length === 0) throw ApiError.badRequest('변경할 내용이 없습니다.')

      const { error } = await db.from('board_agendas').update(update).eq('id', id)
      if (error) throw ApiError.internalServerError('안건 수정에 실패했습니다.')
      return ApiSuccess.ok({ id }, '안건이 수정되었습니다.')
    },
    `/api/board-room/agendas/${id}`,
    { userId: user.id }
  )
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user, isAdmin } = auth

  return apiDelete(
    async () => {
      const { owner, error: ownerErr } = await loadAgendaOwner(db, id)
      if (ownerErr || owner === undefined) throw ApiError.notFound('안건을 찾을 수 없습니다.')
      if (owner !== user.id && !isAdmin) throw ApiError.forbidden('삭제 권한이 없습니다.')
      const { error } = await db.from('board_agendas').delete().eq('id', id)
      if (error) throw ApiError.internalServerError('안건 삭제에 실패했습니다.')
      return ApiSuccess.ok({ id }, '안건이 삭제되었습니다.')
    },
    `/api/board-room/agendas/${id}`,
    { userId: user.id }
  )
}
