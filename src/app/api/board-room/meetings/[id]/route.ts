import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPatch, apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  requireBoardMember,
  requireBoardAdmin,
  getDirectorRoster,
} from '@/lib/server/boardRoomAuth'
import { notifyDirectors } from '@/lib/server/boardRoomNotify'
import { BOARD_MEETING_TIME } from '@/constants/boardRoom'
import { requiredQuorum, isQuorumMet } from '@/lib/boardRoom/quorum'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth

  return apiGet(
    async () => {
      const { data: meeting, error } = await db
        .from('board_meetings')
        .select('id, title, meeting_date, location, status, vote_deadline, created_at')
        .eq('id', id)
        .single()
      if (error || !meeting) throw ApiError.notFound('회의를 찾을 수 없습니다.')

      const { data: options, error: optionsErr } = await db
        .from('board_meeting_date_options')
        .select('id, candidate_date')
        .eq('meeting_id', id)
        .order('candidate_date', { ascending: true })
      if (optionsErr) throw ApiError.internalServerError('후보 날짜를 불러올 수 없습니다.')

      const optionIds = (options ?? []).map(o => o.id)
      let votes: { option_id: string; voter_id: string; is_available: boolean }[]
      if (optionIds.length > 0) {
        const { data: votesData, error: votesErr } = await db
          .from('board_meeting_date_votes')
          .select('option_id, voter_id, is_available')
          .in('option_id', optionIds)
        if (votesErr) throw ApiError.internalServerError('투표 정보를 불러올 수 없습니다.')
        votes = votesData ?? []
      } else {
        votes = []
      }

      const { data: agendas, error: agendasErr } = await db
        .from('board_agendas')
        .select('id, title, content, sort_order, status, proposed_by, created_at')
        .eq('meeting_id', id)
        .order('sort_order', { ascending: true })
      if (agendasErr) throw ApiError.internalServerError('안건을 불러올 수 없습니다.')

      const { data: minutes, error: minutesErr } = await db
        .from('board_minutes')
        .select('id, content, content_format, author_id, updated_at')
        .eq('meeting_id', id)
        .maybeSingle()
      if (minutesErr) throw ApiError.internalServerError('회의록을 불러올 수 없습니다.')

      const { data: attendees, error: attendeesErr } = await db
        .from('board_meeting_attendees')
        .select('member_id, attended')
        .eq('meeting_id', id)
      if (attendeesErr) throw ApiError.internalServerError('출석 정보를 불러올 수 없습니다.')

      const roster = await getDirectorRoster(db)
      const attendedCount = (attendees ?? []).filter(a => a.attended).length

      return ApiSuccess.ok({
        meeting,
        meeting_time: BOARD_MEETING_TIME,
        options: options ?? [],
        votes: votes ?? [],
        agendas: agendas ?? [],
        minutes: minutes ?? null,
        roster,
        attendees: attendees ?? [],
        quorum: {
          total: roster.length,
          required: requiredQuorum(roster.length),
          attended: attendedCount,
          met: isQuorumMet(roster.length, attendedCount),
        },
        current_user_id: user.id,
      })
    },
    `/api/board-room/meetings/${id}`,
    { userId: user.id }
  )
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const adminGuard = requireBoardAdmin(auth)
  if (adminGuard) return adminGuard
  const { db, user } = auth

  return apiPatch(
    async () => {
      const body = await request.json()
      const update: Record<string, unknown> = {}

      if (typeof body.title === 'string') update.title = body.title.trim()
      if (body.location === null || typeof body.location === 'string')
        update.location = body.location
      if (body.vote_deadline === null || typeof body.vote_deadline === 'string') {
        update.vote_deadline = body.vote_deadline
      }

      if (body.confirm_date) {
        const { data: opt } = await db
          .from('board_meeting_date_options')
          .select('id')
          .eq('meeting_id', id)
          .eq('candidate_date', body.confirm_date)
          .maybeSingle()
        if (!opt) throw ApiError.badRequest('후보에 없는 날짜는 확정할 수 없습니다.')
        update.meeting_date = body.confirm_date
        update.status = 'scheduled'
      }

      if (body.status === 'completed') update.status = 'completed'

      if (Object.keys(update).length === 0) throw ApiError.badRequest('변경할 내용이 없습니다.')

      const { data: updated, error } = await db
        .from('board_meetings')
        .update(update)
        .eq('id', id)
        .select('title, meeting_date')
        .single()
      if (error || !updated) throw ApiError.internalServerError('회의 수정에 실패했습니다.')

      if (body.confirm_date) {
        await notifyDirectors(db, {
          title: '이사회 일정 확정',
          message: `'${updated.title}' 회의가 ${body.confirm_date} ${BOARD_MEETING_TIME}로 확정되었습니다.`,
          meetingId: id,
        })
      }

      return ApiSuccess.ok({ id }, '회의가 수정되었습니다.')
    },
    `/api/board-room/meetings/${id}`,
    { userId: user.id }
  )
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const adminGuard = requireBoardAdmin(auth)
  if (adminGuard) return adminGuard
  const { db, user } = auth

  return apiDelete(
    async () => {
      const { error } = await db.from('board_meetings').delete().eq('id', id)
      if (error) throw ApiError.internalServerError('회의 삭제에 실패했습니다.')
      return ApiSuccess.ok({ id }, '회의가 삭제되었습니다.')
    },
    `/api/board-room/meetings/${id}`,
    { userId: user.id }
  )
}
