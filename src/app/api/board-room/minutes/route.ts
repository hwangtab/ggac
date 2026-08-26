import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { notifyDirectors } from '@/lib/server/boardRoomNotify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { parseContentFormat } from '@/constants/contentFormat'
import { annotateImageDimensionsSafe } from '@/utils/imageDimensions'
import {
  createMinutes,
  getMeetingTitle,
  getMinutesIdByMeetingId,
  isDuplicateMinutesError,
} from '@/db/queries/board'

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
  const { user } = auth

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

      let existingId: string | null
      try {
        existingId = await getMinutesIdByMeetingId(sanitizedMeetingId)
      } catch {
        throw ApiError.internalServerError('회의록 조회에 실패했습니다.')
      }
      if (existingId) throw ApiError.conflict('이미 회의록이 존재합니다.')

      // html 본문일 때만 저장 전 이미지 크기 주입(CLS 방지). Safe 래퍼는 절대 throw 안 함.
      const contentToSave =
        contentFormat === 'html' ? await annotateImageDimensionsSafe(content) : content

      let minutes: { id: string }
      try {
        minutes = await createMinutes({
          meetingId: sanitizedMeetingId,
          content: contentToSave,
          contentFormat,
          authorId: user.id,
        })
      } catch (createError) {
        // 위 `getMinutesIdByMeetingId` 검사와 이 INSERT 사이에 다른 이사가
        // 같은 회의의 회의록을 먼저 올리면 `board_minutes.meeting_id` UNIQUE에
        // 걸린다(단계 4 Task 6a가 그 제약을 복원하면서 드러났다 — 그전에는
        // 중복이 조용히 들어갔다). 원인을 삼키고 500을 주면, 이사는 "서버
        // 오류"를 보고 다시 시도하게 된다. 사실은 이미 회의록이 있는 것이므로
        // 위 사전 검사와 **같은 409**로 답한다.
        if (isDuplicateMinutesError(createError)) {
          throw ApiError.conflict('이미 회의록이 존재합니다.')
        }
        throw ApiError.internalServerError('회의록 생성에 실패했습니다.')
      }

      const meetingTitle = await getMeetingTitle(sanitizedMeetingId)
      await notifyDirectors({
        title: '회의록 작성',
        message: `'${meetingTitle ?? '이사회'}' 회의록이 작성되었습니다.`,
        meetingId: sanitizedMeetingId,
      })

      return ApiSuccess.created({ id: minutes.id }, '회의록이 작성되었습니다.')
    },
    '/api/board-room/minutes',
    { userId: user.id }
  )
}
