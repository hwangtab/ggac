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
  parseBoardMeetingTime,
  resolveBoardMeetingTime,
  parseBoardMeetingDate,
  parseBoardMeetingDeadline,
} from '@/constants/boardRoom'
import { requiredQuorum, isQuorumMet } from '@/lib/boardRoom/quorum'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import {
  deleteMeeting,
  getDateOptionByMeetingAndDate,
  getMeetingById,
  listAgendasByMeeting,
  listDateOptions,
  listDateVotesByOptionIds,
  listMeetingAttendees,
  getMinutesByMeetingId,
  updateMeeting,
  type MeetingUpdatePatch,
} from '@/db/queries/board'
import { countCommentsByAgendas } from '@/db/queries/boardAgendaComments'
import { createLogger } from '@/utils/logger'

export const runtime = 'nodejs'

const log = createLogger('boardMeetingDetail')

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
  const { user } = auth

  return apiGet(
    async () => {
      const meeting = await getMeetingById(id)
      if (!meeting) throw ApiError.notFound('회의를 찾을 수 없습니다.')

      let options: Awaited<ReturnType<typeof listDateOptions>>
      try {
        options = await listDateOptions(id)
      } catch {
        throw ApiError.internalServerError('후보 날짜를 불러올 수 없습니다.')
      }

      const optionIds = options.map(o => o.id)
      let votes: Awaited<ReturnType<typeof listDateVotesByOptionIds>>
      try {
        votes = await listDateVotesByOptionIds(optionIds)
      } catch {
        throw ApiError.internalServerError('투표 정보를 불러올 수 없습니다.')
      }

      let agendas: Awaited<ReturnType<typeof listAgendasByMeeting>>
      try {
        agendas = await listAgendasByMeeting(id)
      } catch {
        throw ApiError.internalServerError('안건을 불러올 수 없습니다.')
      }

      // 토론 배지용 개수만 함께 싣는다. 본문은 안건을 펼칠 때 따로 받는다 —
      // 안건 10개짜리 회의의 스레드를 상세 응답에 미리 담을 이유가 없다.
      //
      // 실패해도 던지지 않는다. 배포(`git push`)와 마이그레이션 적용은 별개
      // 절차라 `board_agenda_comments`가 아직 없는 창이 열릴 수 있는데, 그때
      // 던지면 **배지 하나 때문에 회의 상세 전체가 500**이 된다. 배지는 0으로
      // 떨어지고 회의·안건·회의록은 그대로 보이는 쪽이 옳다.
      // 실패는 삼키되 **반드시 남긴다**. 이 라우트의 다른 로더들은 전부
      // 500을 던지는데 여기만 통과시키므로, 로그가 없으면 "토론 0"이 진짜
      // 0인지 조회가 죽은 건지 아무도 구분하지 못한다.
      let commentCounts: Record<string, number> = {}
      try {
        commentCounts = await countCommentsByAgendas(agendas.map(a => a.id))
      } catch (e) {
        log.error('안건 토론 수 조회 실패 — 배지를 0으로 표시한다', {
          meetingId: id,
          error: (e as Error).message,
        })
        commentCounts = {}
      }
      const agendasWithCounts = agendas.map(agenda => ({
        ...agenda,
        comment_count: commentCounts[agenda.id] ?? 0,
      }))

      let minutes: Awaited<ReturnType<typeof getMinutesByMeetingId>>
      try {
        minutes = await getMinutesByMeetingId(id)
      } catch {
        throw ApiError.internalServerError('회의록을 불러올 수 없습니다.')
      }

      let attendees: Awaited<ReturnType<typeof listMeetingAttendees>>
      try {
        attendees = await listMeetingAttendees(id)
      } catch {
        throw ApiError.internalServerError('출석 정보를 불러올 수 없습니다.')
      }

      const roster = await getDirectorRoster()
      const auditors = await getAuditorRoster()
      // 정족수는 재적 이사(roster)만으로 산정 — 감사(auditors)는 산입하지 않는다.
      const attendedCount = attendees.filter(
        a => a.attended && roster.some(r => r.id === a.member_id)
      ).length

      return ApiSuccess.ok({
        meeting,
        meeting_time: resolveBoardMeetingTime(meeting.meeting_time),
        options,
        votes,
        agendas: agendasWithCounts,
        minutes,
        roster,
        auditors,
        attendees,
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
  const { user } = auth

  return apiPatch(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const update: MeetingUpdatePatch = {}

      if (typeof body.title === 'string') {
        const title = body.title.trim()
        if (!title) throw ApiError.badRequest('제목을 입력해주세요.')
        update.title = title
      }
      if (body.location === null || typeof body.location === 'string')
        update.location = typeof body.location === 'string' ? body.location.trim() || null : null
      if (body.vote_deadline === null) {
        update.voteDeadline = null
      } else if (body.vote_deadline !== undefined) {
        const voteDeadline = parseBoardMeetingDeadline(body.vote_deadline)
        if (!voteDeadline) throw ApiError.badRequest('투표 마감일 형식이 올바르지 않습니다.')
        update.voteDeadline = new Date(voteDeadline)
      }

      if (body.meeting_time === null) {
        // 명시적 null은 '기본 시각으로 되돌린다'는 뜻이다.
        update.meetingTime = null
      } else if (body.meeting_time !== undefined) {
        const meetingTime = parseBoardMeetingTime(body.meeting_time)
        if (!meetingTime) throw ApiError.badRequest('회의 시각은 HH:MM(24시간) 형식이어야 합니다.')
        update.meetingTime = meetingTime
      }

      const confirmDate = parseBoardMeetingDate(body.confirm_date)
      if (body.confirm_date !== undefined && !confirmDate) {
        throw ApiError.badRequest('확정 날짜는 YYYY-MM-DD 형식이어야 합니다.')
      }

      if (confirmDate) {
        const opt = await getDateOptionByMeetingAndDate(id, confirmDate)
        if (!opt) throw ApiError.badRequest('후보에 없는 날짜는 확정할 수 없습니다.')
        update.meetingDate = confirmDate
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

      let updated: {
        title: string
        meeting_date: string | null
        meeting_time: string | null
      } | null
      try {
        updated = await updateMeeting(id, update)
      } catch {
        updated = null
      }
      if (!updated) throw ApiError.internalServerError('회의 수정에 실패했습니다.')

      if (confirmDate) {
        await notifyDirectors({
          title: '이사회 일정 확정',
          message: `'${updated.title}' 회의가 ${confirmDate} ${resolveBoardMeetingTime(updated.meeting_time)}로 확정되었습니다.`,
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
  const { user } = auth

  return apiDelete(
    async () => {
      try {
        await deleteMeeting(id)
      } catch {
        throw ApiError.internalServerError('회의 삭제에 실패했습니다.')
      }
      return ApiSuccess.ok({ id }, '회의가 삭제되었습니다.')
    },
    `/api/board-room/meetings/${id}`,
    { userId: user.id }
  )
}
