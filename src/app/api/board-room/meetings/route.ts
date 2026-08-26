import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember, requireBoardAdmin } from '@/lib/server/boardRoomAuth'
import { notifyDirectors } from '@/lib/server/boardRoomNotify'
import {
  BOARD_MEETING_TIME,
  parseBoardMeetingCandidateDates,
  parseBoardMeetingDeadline,
} from '@/constants/boardRoom'
import { createLogger } from '@/utils/logger'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { createDateOptions, createMeeting, deleteMeeting, listMeetings } from '@/db/queries/board'

const log = createLogger('boardRoom/meetings')

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      let meetings: Awaited<ReturnType<typeof listMeetings>>
      try {
        meetings = await listMeetings()
      } catch {
        throw ApiError.internalServerError('회의 목록을 불러올 수 없습니다.')
      }
      return ApiSuccess.ok({ meetings, meeting_time: BOARD_MEETING_TIME })
    },
    '/api/board-room/meetings',
    { userId: user.id }
  )
}

export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const adminGuard = requireBoardAdmin(auth)
  if (adminGuard) return adminGuard
  const { user } = auth

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const candidateDates = parseBoardMeetingCandidateDates(body.candidate_dates)
      const voteDeadline = parseBoardMeetingDeadline(body.vote_deadline)
      const location = typeof body.location === 'string' ? body.location.trim() || null : null

      if (!title) throw ApiError.badRequest('제목을 입력해주세요.')
      if (!candidateDates)
        throw ApiError.badRequest('후보 날짜는 YYYY-MM-DD 형식으로 1개 이상 선택해주세요.')
      if (!voteDeadline) throw ApiError.badRequest('투표 마감일을 설정해주세요.')

      let meeting: { id: string }
      try {
        meeting = await createMeeting({
          title,
          location,
          voteDeadline: new Date(voteDeadline),
          createdBy: user.id,
        })
      } catch {
        throw ApiError.internalServerError('회의 생성에 실패했습니다.')
      }

      try {
        await createDateOptions(meeting.id, candidateDates)
      } catch {
        try {
          await deleteMeeting(meeting.id)
        } catch (cleanupErr) {
          log.error('회의 롤백 실패: 고아 회의 발생', {
            meetingId: meeting.id,
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          })
        }
        throw ApiError.internalServerError('후보 날짜 저장에 실패했습니다.')
      }

      await notifyDirectors({
        title: '이사회 일정 투표 요청',
        message: `'${title}' 회의 일정 투표가 시작되었습니다. 가능한 날짜에 투표해주세요.`,
        meetingId: meeting.id,
      })

      return ApiSuccess.created({ id: meeting.id }, '회의가 생성되고 투표가 시작되었습니다.')
    },
    '/api/board-room/meetings',
    { userId: user.id }
  )
}
