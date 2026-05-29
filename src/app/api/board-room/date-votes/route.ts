import { NextRequest, NextResponse } from 'next/server'
import { apiPut, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'

export const runtime = 'nodejs'

export async function PUT(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth

  return apiPut(
    async () => {
      const body = await request.json()
      const optionId: string = body.option_id
      const isAvailable: boolean = body.is_available
      if (!optionId || typeof isAvailable !== 'boolean') {
        throw ApiError.badRequest('option_id와 is_available이 필요합니다.')
      }

      const { data: opt, error: optErr } = await db
        .from('board_meeting_date_options')
        .select('id, meeting_id')
        .eq('id', optionId)
        .single()
      if (optErr || !opt) throw ApiError.notFound('후보 날짜를 찾을 수 없습니다.')

      const { data: meeting, error: mErr } = await db
        .from('board_meetings')
        .select('status, vote_deadline')
        .eq('id', opt.meeting_id)
        .single()
      if (mErr || !meeting) throw ApiError.notFound('회의를 찾을 수 없습니다.')
      if (meeting.status !== 'polling') throw ApiError.forbidden('투표가 마감된 회의입니다.')
      if (meeting.vote_deadline && new Date(meeting.vote_deadline).getTime() < Date.now()) {
        throw ApiError.forbidden('투표 마감 시간이 지났습니다.')
      }

      const { error } = await db
        .from('board_meeting_date_votes')
        .upsert(
          { option_id: optionId, voter_id: user.id, is_available: isAvailable },
          { onConflict: 'option_id,voter_id' }
        )
      if (error) throw ApiError.internalServerError('투표 저장에 실패했습니다.')

      return ApiSuccess.ok(
        { option_id: optionId, is_available: isAvailable },
        '투표가 저장되었습니다.'
      )
    },
    '/api/board-room/date-votes',
    { userId: user.id }
  )
}
