import { NextRequest, NextResponse } from 'next/server'
import { apiPatch, apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'

export const runtime = 'nodejs'

async function loadMinutesAuthor(db: any, id: string) {
  const { data, error } = await db.from('board_minutes').select('author_id').eq('id', id).single()
  if (error) return { error }
  return { author: data?.author_id as string | undefined }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user, isAdmin } = auth

  return apiPatch(
    async () => {
      const { author, error: authorErr } = await loadMinutesAuthor(db, id)
      if (authorErr || author === undefined) throw ApiError.notFound('회의록을 찾을 수 없습니다.')
      if (author !== user.id && !isAdmin) throw ApiError.forbidden('편집 권한이 없습니다.')

      const body = await request.json()
      const update: Record<string, unknown> = {}
      if (typeof body.content === 'string') update.content = body.content
      if (typeof body.content_format === 'string') update.content_format = body.content_format
      if (Object.keys(update).length === 0) throw ApiError.badRequest('변경할 내용이 없습니다.')

      const { error } = await db.from('board_minutes').update(update).eq('id', id)
      if (error) throw ApiError.internalServerError('회의록 편집에 실패했습니다.')
      return ApiSuccess.ok({ id }, '회의록이 수정되었습니다.')
    },
    `/api/board-room/minutes/${id}`,
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
      const { author, error: authorErr } = await loadMinutesAuthor(db, id)
      if (authorErr || author === undefined) throw ApiError.notFound('회의록을 찾을 수 없습니다.')
      if (author !== user.id && !isAdmin) throw ApiError.forbidden('삭제 권한이 없습니다.')
      const { error } = await db.from('board_minutes').delete().eq('id', id)
      if (error) throw ApiError.internalServerError('회의록 삭제에 실패했습니다.')
      return ApiSuccess.ok({ id }, '회의록이 삭제되었습니다.')
    },
    `/api/board-room/minutes/${id}`,
    { userId: user.id }
  )
}
