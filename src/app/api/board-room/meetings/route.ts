import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember, requireBoardAdmin } from '@/lib/server/boardRoomAuth'
import { notifyDirectors } from '@/lib/server/boardRoomNotify'
import { BOARD_MEETING_TIME } from '@/constants/boardRoom'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth

  return apiGet(
    async () => {
      const { data, error } = await db
        .from('board_meetings')
        .select('id, title, meeting_date, location, status, vote_deadline, created_at')
        .order('created_at', { ascending: false })
      if (error) throw ApiError.internalServerError('회의 목록을 불러올 수 없습니다.')
      return ApiSuccess.ok({ meetings: data, meeting_time: BOARD_MEETING_TIME })
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
  const { db, user } = auth

  return apiPost(
    async () => {
      const body = await request.json()
      const title: string = (body.title || '').trim()
      const candidateDates: string[] = Array.isArray(body.candidate_dates)
        ? body.candidate_dates
        : []
      const voteDeadline: string | null = body.vote_deadline || null
      const location: string | null = body.location || null

      if (!title) throw ApiError.badRequest('제목을 입력해주세요.')
      if (candidateDates.length === 0)
        throw ApiError.badRequest('후보 날짜를 1개 이상 선택해주세요.')
      if (!voteDeadline) throw ApiError.badRequest('투표 마감일을 설정해주세요.')

      const { data: meeting, error: mErr } = await db
        .from('board_meetings')
        .insert({
          title,
          location,
          status: 'polling',
          vote_deadline: voteDeadline,
          created_by: user.id,
        })
        .select('id')
        .single()
      if (mErr || !meeting) throw ApiError.internalServerError('회의 생성에 실패했습니다.')

      const optionRows = candidateDates.map((d) => ({
        meeting_id: meeting.id,
        candidate_date: d,
      }))
      const { error: oErr } = await db.from('board_meeting_date_options').insert(optionRows)
      if (oErr) {
        await db.from('board_meetings').delete().eq('id', meeting.id)
        throw ApiError.internalServerError('후보 날짜 저장에 실패했습니다.')
      }

      await notifyDirectors(db, {
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
