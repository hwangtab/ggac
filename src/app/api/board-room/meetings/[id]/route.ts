import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPatch, apiDelete, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  requireBoardMember,
  requireBoardAdmin,
  getDirectorRoster,
  getAuditorRoster,
} from '@/lib/server/boardRoomAuth'
import { notifyDirectors } from '@/lib/server/boardRoomNotify'
import {
  BOARD_MEETING_STATUS,
  BOARD_MEETING_TIME,
  parseBoardMeetingDate,
  parseBoardMeetingDeadline,
} from '@/constants/boardRoom'
import { requiredQuorum, isQuorumMet } from '@/lib/boardRoom/quorum'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'

export const runtime = 'nodejs'

function validateMeetingId(id: string) {
  const validation = validateUUID(id, '회의 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 회의 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const routeId = validateMeetingId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
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
      const auditors = await getAuditorRoster(db)
      // 정족수는 재적 이사(roster)만으로 산정 — 감사(auditors)는 산입하지 않는다.
      const attendedCount = (attendees ?? []).filter(
        a => a.attended && roster.some(r => r.id === a.member_id)
      ).length

      return ApiSuccess.ok({
        meeting,
        meeting_time: BOARD_MEETING_TIME,
        options: options ?? [],
        votes: votes ?? [],
        agendas: agendas ?? [],
        minutes: minutes ?? null,
        roster,
        auditors,
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
  const params = await context.params
  const routeId = validateMeetingId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const adminGuard = requireBoardAdmin(auth)
  if (adminGuard) return adminGuard
  const { db, user } = auth

  return apiPatch(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const update: Record<string, unknown> = {}

      if (typeof body.title === 'string') {
        const title = body.title.trim()
        if (!title) throw ApiError.badRequest('제목을 입력해주세요.')
        update.title = title
      }
      if (body.location === null || typeof body.location === 'string')
        update.location = typeof body.location === 'string' ? body.location.trim() || null : null
      if (body.vote_deadline === null) {
        update.vote_deadline = null
      } else if (body.vote_deadline !== undefined) {
        const voteDeadline = parseBoardMeetingDeadline(body.vote_deadline)
        if (!voteDeadline) throw ApiError.badRequest('투표 마감일 형식이 올바르지 않습니다.')
        update.vote_deadline = voteDeadline
      }

      const confirmDate = parseBoardMeetingDate(body.confirm_date)
      if (body.confirm_date !== undefined && !confirmDate) {
        throw ApiError.badRequest('확정 날짜는 YYYY-MM-DD 형식이어야 합니다.')
      }

      if (confirmDate) {
        const { data: opt } = await db
          .from('board_meeting_date_options')
          .select('id')
          .eq('meeting_id', id)
          .eq('candidate_date', confirmDate)
          .maybeSingle()
        if (!opt) throw ApiError.badRequest('후보에 없는 날짜는 확정할 수 없습니다.')
        update.meeting_date = confirmDate
        update.status = 'scheduled'
      }

      if (body.status !== undefined) {
        if (
          body.status !== 'completed' ||
          !(BOARD_MEETING_STATUS as readonly string[]).includes(body.status)
        ) {
          throw ApiError.badRequest('잘못된 회의 상태값입니다.')
        }
        update.status = 'completed'
      }

      if (Object.keys(update).length === 0) throw ApiError.badRequest('변경할 내용이 없습니다.')

      const { data: updated, error } = await db
        .from('board_meetings')
        .update(update)
        .eq('id', id)
        .select('title, meeting_date')
        .single()
      if (error || !updated) throw ApiError.internalServerError('회의 수정에 실패했습니다.')

      if (confirmDate) {
        await notifyDirectors(db, {
          title: '이사회 일정 확정',
          message: `'${updated.title}' 회의가 ${confirmDate} ${BOARD_MEETING_TIME}로 확정되었습니다.`,
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
  const params = await context.params
  const routeId = validateMeetingId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const id = routeId.id
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
