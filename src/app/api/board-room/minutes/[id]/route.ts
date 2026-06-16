import { NextRequest, NextResponse } from 'next/server'
import { apiPatch, apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { parseContentFormat } from '@/constants/contentFormat'

export const runtime = 'nodejs'

function validateMinutesId(id: string) {
  const validation = validateUUID(id, '회의록 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 회의록 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

async function loadMinutesAuthor(db: any, id: string) {
  const { data, error } = await db.from('board_minutes').select('author_id').eq('id', id).single()
  if (error) return { error }
  return { author: data?.author_id as string | undefined }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const routeId = validateMinutesId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user, isAdmin } = auth

  return apiPatch(
    async () => {
      const { author, error: authorErr } = await loadMinutesAuthor(db, id)
      if (authorErr || author === undefined) throw ApiError.notFound('회의록을 찾을 수 없습니다.')
      if (author !== user.id && !isAdmin) throw ApiError.forbidden('편집 권한이 없습니다.')

      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const update: Record<string, unknown> = {}
      if (typeof body.content === 'string') update.content = body.content
      if (body.content_format !== undefined) {
        const contentFormat = parseContentFormat(body.content_format)
        if (!contentFormat) {
          throw ApiError.badRequest('content_format은 plain, html, markdown 중 하나여야 합니다.')
        }
        update.content_format = contentFormat
      }
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
  const params = await context.params
  const routeId = validateMinutesId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
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
