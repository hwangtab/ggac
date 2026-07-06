import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { notifyDirectors } from '@/lib/server/boardRoomNotify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { parseContentFormat } from '@/constants/contentFormat'
import { annotateImageDimensionsSafe } from '@/utils/imageDimensions'

export const runtime = 'nodejs'

function validateMeetingId(id: string) {
  const validation = validateUUID(id, '회의 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 회의 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const meetingId = typeof body.meeting_id === 'string' ? body.meeting_id : ''
      const content = typeof body.content === 'string' ? body.content : ''
      const contentFormat =
        typeof body.content_format === 'string'
          ? parseContentFormat(body.content_format)
          : 'markdown'
      if (!contentFormat) {
        throw ApiError.badRequest('content_format은 plain, html, markdown 중 하나여야 합니다.')
      }
      if (!meetingId) throw ApiError.badRequest('meeting_id가 필요합니다.')
      const routeMeetingId = validateMeetingId(meetingId)
      if (routeMeetingId.error) throw routeMeetingId.error
      const sanitizedMeetingId = routeMeetingId.id

      const { data: existing, error: existErr } = await db
        .from('board_minutes')
        .select('id')
        .eq('meeting_id', sanitizedMeetingId)
        .maybeSingle()
      if (existErr) throw ApiError.internalServerError('회의록 조회에 실패했습니다.')
      if (existing) throw ApiError.conflict('이미 회의록이 존재합니다.')

      // html 본문일 때만 저장 전 이미지 크기 주입(CLS 방지). Safe 래퍼는 절대 throw 안 함.
      const contentToSave =
        contentFormat === 'html' ? await annotateImageDimensionsSafe(content) : content

      const { data: minutes, error } = await db
        .from('board_minutes')
        .insert({
          meeting_id: sanitizedMeetingId,
          content: contentToSave,
          content_format: contentFormat,
          author_id: user.id,
        })
        .select('id')
        .single()
      if (error || !minutes) throw ApiError.internalServerError('회의록 생성에 실패했습니다.')

      const { data: meeting } = await db
        .from('board_meetings')
        .select('title')
        .eq('id', sanitizedMeetingId)
        .single()
      await notifyDirectors(db, {
        title: '회의록 작성',
        message: `'${meeting?.title ?? '이사회'}' 회의록이 작성되었습니다.`,
        meetingId: sanitizedMeetingId,
      })

      return ApiSuccess.created({ id: minutes.id }, '회의록이 작성되었습니다.')
    },
    '/api/board-room/minutes',
    { userId: user.id }
  )
}
