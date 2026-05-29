import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPut, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  requireBoardMember,
  requireBoardAdmin,
  getDirectorRoster,
} from '@/lib/server/boardRoomAuth'
import { requiredQuorum, isQuorumMet } from '@/lib/boardRoom/quorum'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth
  const meetingId = new URL(request.url).searchParams.get('meeting_id')
  if (!meetingId) {
    return ApiError.badRequest('meeting_id가 필요합니다.').toNextResponse()
  }

  return apiGet(
    async () => {
      const roster = await getDirectorRoster(db)
      const { data: attendees, error: attErr } = await db
        .from('board_meeting_attendees')
        .select('member_id, attended')
        .eq('meeting_id', meetingId)
      if (attErr) throw ApiError.internalServerError('출석 정보를 불러올 수 없습니다.')
      const attendedCount = (attendees ?? []).filter(a => a.attended).length
      return ApiSuccess.ok({
        roster,
        attendees: attendees ?? [],
        quorum: {
          total: roster.length,
          required: requiredQuorum(roster.length),
          attended: attendedCount,
          met: isQuorumMet(roster.length, attendedCount),
        },
      })
    },
    '/api/board-room/attendees',
    { userId: user.id }
  )
}

export async function PUT(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const adminGuard = requireBoardAdmin(auth)
  if (adminGuard) return adminGuard
  const { db, user } = auth

  return apiPut(
    async () => {
      const body = await request.json()
      const meetingId: string = body.meeting_id
      const records: { member_id: string; attended: boolean }[] = body.attendees || []
      if (!meetingId || !Array.isArray(records)) {
        throw ApiError.badRequest('meeting_id와 attendees 배열이 필요합니다.')
      }
      const rows = records
        .filter(r => r && typeof r.member_id === 'string')
        .map(r => ({
          meeting_id: meetingId,
          member_id: r.member_id,
          attended: !!r.attended,
        }))
      const { error } = await db
        .from('board_meeting_attendees')
        .upsert(rows, { onConflict: 'meeting_id,member_id' })
      if (error) throw ApiError.internalServerError('출석 저장에 실패했습니다.')
      return ApiSuccess.ok({ meeting_id: meetingId }, '출석이 저장되었습니다.')
    },
    '/api/board-room/attendees',
    { userId: user.id }
  )
}
