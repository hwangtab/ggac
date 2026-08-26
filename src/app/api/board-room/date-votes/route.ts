import { NextRequest, NextResponse } from 'next/server'
import { apiPut, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { getDateOptionMeetingId, getMeetingVotingState, upsertDateVote } from '@/db/queries/board'

export const runtime = 'nodejs'

function validateOptionId(id: string) {
  const validation = validateUUID(id, '후보 날짜 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 후보 날짜 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function PUT(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPut(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const optionId = typeof body.option_id === 'string' ? body.option_id : ''
      const isAvailable = body.is_available
      if (!optionId || typeof isAvailable !== 'boolean') {
        throw ApiError.badRequest('option_id와 is_available이 필요합니다.')
      }
      const routeOptionId = validateOptionId(optionId)
      if (routeOptionId.error) throw routeOptionId.error
      const sanitizedOptionId = routeOptionId.id

      const opt = await getDateOptionMeetingId(sanitizedOptionId)
      if (!opt) throw ApiError.notFound('후보 날짜를 찾을 수 없습니다.')

      const meeting = await getMeetingVotingState(opt.meeting_id)
      if (!meeting) throw ApiError.notFound('회의를 찾을 수 없습니다.')
      if (meeting.status !== 'polling') throw ApiError.forbidden('투표가 마감된 회의입니다.')
      if (meeting.vote_deadline && new Date(meeting.vote_deadline).getTime() < Date.now()) {
        throw ApiError.forbidden('투표 마감 시간이 지났습니다.')
      }

      try {
        await upsertDateVote(sanitizedOptionId, user.id, isAvailable)
      } catch {
        throw ApiError.internalServerError('투표 저장에 실패했습니다.')
      }

      return ApiSuccess.ok(
        { option_id: sanitizedOptionId, is_available: isAvailable },
        '투표가 저장되었습니다.'
      )
    },
    '/api/board-room/date-votes',
    { userId: user.id }
  )
}
