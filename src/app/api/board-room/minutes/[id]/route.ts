import { NextRequest, NextResponse } from 'next/server'
import { apiPatch, apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { parseContentFormat } from '@/constants/contentFormat'
import { annotateImageDimensionsSafe } from '@/utils/imageDimensions'
import { deleteMinutes, getMinutesAuthorAndFormat, updateMinutes } from '@/db/queries/board'

export const runtime = 'nodejs'

function validateMinutesId(id: string) {
  const validation = validateUUID(id, '회의록 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 회의록 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

async function loadMinutesAuthor(id: string) {
  // author_id와 content_format을 한 번에 읽어, 아래 PATCH가 포맷 재조회 없이 재사용한다.
  // 행이 없으면(notFound 대상) error:true, 행은 있지만 author_id가 NULL이면
  // author: null을 그대로 돌려준다 — null을 undefined로 뭉개면 "없음"과
  // "주인 없음"을 못 가려 관리자도 못 고치는 회귀가 생긴다(board_documents의
  // uploaded_by NULL 시드 문제와 같은 종류).
  const row = await getMinutesAuthorAndFormat(id)
  if (!row) return { error: true as const }
  return {
    author: row.author_id,
    contentFormat: row.content_format,
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const routeId = validateMinutesId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user, isAdmin } = auth

  return apiPatch(
    async () => {
      const {
        author,
        contentFormat: existingContentFormat,
        error: authorErr,
      } = await loadMinutesAuthor(id)
      if (authorErr || author === undefined) throw ApiError.notFound('회의록을 찾을 수 없습니다.')
      if (author !== user.id && !isAdmin) throw ApiError.forbidden('편집 권한이 없습니다.')

      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const update: { content?: string; contentFormat?: string } = {}

      // 포맷을 먼저 확정(요청에 있으면 검증). content 주석 여부 판단에도 재사용한다.
      let bodyContentFormat: string | null = null
      if (body.content_format !== undefined) {
        bodyContentFormat = parseContentFormat(body.content_format)
        if (!bodyContentFormat) {
          throw ApiError.badRequest('content_format은 plain, html, markdown 중 하나여야 합니다.')
        }
        update.contentFormat = bodyContentFormat
      }

      if (typeof body.content === 'string') {
        // content와 format은 독립적으로 수정될 수 있다. "유효 포맷"이 html일 때만 이미지
        // 크기를 주입한다. 이번 요청에 포맷이 없으면 위 loadMinutesAuthor가 이미 읽어둔
        // 기존 행의 content_format을 재사용한다(추가 조회 없음).
        const effectiveFormat: string | null = bodyContentFormat ?? existingContentFormat
        update.content =
          effectiveFormat === 'html'
            ? await annotateImageDimensionsSafe(body.content)
            : body.content
      }

      if (Object.keys(update).length === 0) throw ApiError.badRequest('변경할 내용이 없습니다.')

      try {
        await updateMinutes(id, update)
      } catch {
        throw ApiError.internalServerError('회의록 편집에 실패했습니다.')
      }
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
  const { user, isAdmin } = auth

  return apiDelete(
    async () => {
      const { author, error: authorErr } = await loadMinutesAuthor(id)
      if (authorErr || author === undefined) throw ApiError.notFound('회의록을 찾을 수 없습니다.')
      if (author !== user.id && !isAdmin) throw ApiError.forbidden('삭제 권한이 없습니다.')
      try {
        await deleteMinutes(id)
      } catch {
        throw ApiError.internalServerError('회의록 삭제에 실패했습니다.')
      }
      return ApiSuccess.ok({ id }, '회의록이 삭제되었습니다.')
    },
    `/api/board-room/minutes/${id}`,
    { userId: user.id }
  )
}
