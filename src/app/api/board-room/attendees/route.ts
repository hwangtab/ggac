import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPut, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  requireBoardMember,
  requireBoardAdmin,
  getDirectorRoster,
  getAuditorRoster,
} from '@/lib/server/boardRoomAuth'
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

function validateMemberId(id: string) {
  const validation = validateUUID(id, '출석 대상 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 출석 대상 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function GET(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth
  const meetingId = new URL(request.url).searchParams.get('meeting_id')
  if (!meetingId) {
    return ApiError.badRequest('meeting_id가 필요합니다.').toNextResponse()
  }
  const routeMeetingId = validateMeetingId(meetingId)
  if (routeMeetingId.error) return routeMeetingId.error.toNextResponse()
  const sanitizedMeetingId = routeMeetingId.id

  return apiGet(
    async () => {
      const roster = await getDirectorRoster(db)
      const auditors = await getAuditorRoster(db)
      const { data: attendees, error: attErr } = await db
        .from('board_meeting_attendees')
        .select('member_id, attended')
        .eq('meeting_id', sanitizedMeetingId)
      if (attErr) throw ApiError.internalServerError('출석 정보를 불러올 수 없습니다.')
      // 정족수는 재적 이사(roster)만으로 산정 — 감사(auditors)는 산입하지 않는다.
      const attendedCount = (attendees ?? []).filter(
        a => a.attended && roster.some(r => r.id === a.member_id)
      ).length
      return ApiSuccess.ok({
        roster,
        auditors,
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
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const meetingId = typeof body.meeting_id === 'string' ? body.meeting_id : ''
      const records = Array.isArray(body.attendees) ? body.attendees : []
      if (!meetingId || !Array.isArray(records)) {
        throw ApiError.badRequest('meeting_id와 attendees 배열이 필요합니다.')
      }
      const routeMeetingId = validateMeetingId(meetingId)
      if (routeMeetingId.error) throw routeMeetingId.error
      const sanitizedMeetingId = routeMeetingId.id

      const rows = records.map(r => {
        if (!r || typeof r.member_id !== 'string') {
          throw ApiError.badRequest('attendees 배열에 유효한 member_id가 필요합니다.')
        }
        const memberId = validateMemberId(r.member_id)
        if (memberId.error) throw memberId.error
        return {
          meeting_id: sanitizedMeetingId,
          member_id: memberId.id,
          attended: !!r.attended,
        }
      })
      const { error } = await db
        .from('board_meeting_attendees')
        .upsert(rows, { onConflict: 'meeting_id,member_id' })
      if (error) throw ApiError.internalServerError('출석 저장에 실패했습니다.')
      return ApiSuccess.ok({ meeting_id: sanitizedMeetingId }, '출석이 저장되었습니다.')
    },
    '/api/board-room/attendees',
    { userId: user.id }
  )
}
