import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  requireBoardMember,
  requireBoardAdmin,
  requireBoardRecordReader,
} from '@/lib/server/boardRoomAuth'
import { notifyDirectors } from '@/lib/server/boardRoomNotify'
import {
  DEFAULT_BOARD_MEETING_TIME,
  parseBoardMeetingCandidateDates,
  parseBoardMeetingDeadline,
  parseBoardMeetingTime,
} from '@/constants/boardRoom'
import { createLogger } from '@/utils/logger'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { createMeetingWithDateOptions, listMeetings } from '@/db/queries/board'

const log = createLogger('boardRoom/meetings')

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  // 회의 목록은 조합원도 읽는다(안건·회의록으로 들어가는 입구). 회의 생성·수정은
  // 아래 POST가 그대로 이사·관리자에게만 열려 있다.
  const auth = await requireBoardRecordReader()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      let meetings: Awaited<ReturnType<typeof listMeetings>>
      try {
        // 방어적 상한(기본 500). 잘리면 로그로만 알린다 — 응답 형태는 기존
        // 소비자를 위해 그대로 둔다.
        meetings = await listMeetings({
          onTruncated: ({ limit }) =>
            log.error('회의 목록이 상한에 걸려 잘렸다 — 페이지네이션이 필요하다', { limit }),
        })
      } catch {
        throw ApiError.internalServerError('회의 목록을 불러올 수 없습니다.')
      }
      // `meeting_time`은 예전에 '모든 회의의 시각'이었다. 이제 회의별 시각은
      // 각 행의 `meeting_time`에 있고, 이 키는 시각이 비어 있는 회의에 쓰는
      // 기본값이다. 기존 소비자가 깨지지 않게 키 이름은 그대로 둔다.
      return ApiSuccess.ok({
        meetings,
        meeting_time: DEFAULT_BOARD_MEETING_TIME,
        default_meeting_time: DEFAULT_BOARD_MEETING_TIME,
      })
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
      const meetingTime =
        body.meeting_time === undefined || body.meeting_time === null
          ? null
          : parseBoardMeetingTime(body.meeting_time)

      if (!title) throw ApiError.badRequest('제목을 입력해주세요.')
      if (body.meeting_time !== undefined && body.meeting_time !== null && !meetingTime)
        throw ApiError.badRequest('회의 시각은 HH:MM(24시간) 형식이어야 합니다.')
      if (!candidateDates)
        throw ApiError.badRequest('후보 날짜는 YYYY-MM-DD 형식으로 1개 이상 선택해주세요.')
      if (!voteDeadline) throw ApiError.badRequest('투표 마감일을 설정해주세요.')

      // 회의 + 후보 날짜를 한 트랜잭션으로 만든다. 예전에는 두 INSERT를 따로
      // 부르고 뒤쪽이 실패하면 손수 삭제해 보상했는데, 그 삭제마저 실패하면
      // 투표를 시작할 수 없는 고아 회의가 목록에 남고 알림만 나갔다.
      let meeting: { id: string }
      try {
        meeting = await createMeetingWithDateOptions(
          {
            title,
            location,
            meetingTime,
            voteDeadline: new Date(voteDeadline),
            createdBy: user.id,
          },
          candidateDates
        )
      } catch (err) {
        log.error('회의 생성 실패(트랜잭션 롤백됨)', {
          error: err instanceof Error ? err.message : String(err),
        })
        throw ApiError.internalServerError('회의 생성에 실패했습니다.')
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
