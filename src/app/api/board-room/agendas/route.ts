import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { notifyDirectors } from '@/lib/server/boardRoomNotify'
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

export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const meetingId = typeof body.meeting_id === 'string' ? body.meeting_id : ''
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const content = typeof body.content === 'string' ? body.content : null
      if (!meetingId || !title) throw ApiError.badRequest('meeting_id와 제목이 필요합니다.')
      const routeMeetingId = validateMeetingId(meetingId)
      if (routeMeetingId.error) throw routeMeetingId.error
      const sanitizedMeetingId = routeMeetingId.id

      const { data: lastRow, error: lastErr } = await db
        .from('board_agendas')
        .select('sort_order')
        .eq('meeting_id', sanitizedMeetingId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastErr) throw ApiError.internalServerError('안건 순서를 조회할 수 없습니다.')
      const nextOrder = (lastRow?.sort_order ?? -1) + 1

      const { data: agenda, error } = await db
        .from('board_agendas')
        .insert({
          meeting_id: sanitizedMeetingId,
          title,
          content,
          sort_order: nextOrder,
          status: 'proposed',
          proposed_by: user.id,
        })
        .select('id')
        .single()
      if (error || !agenda) throw ApiError.internalServerError('안건 추가에 실패했습니다.')

      const { data: meeting } = await db
        .from('board_meetings')
        .select('title')
        .eq('id', sanitizedMeetingId)
        .single()
      await notifyDirectors(db, {
        title: '새 안건 등록',
        message: `'${meeting?.title ?? '이사회'}'에 새 안건이 등록되었습니다: ${title}`,
        meetingId: sanitizedMeetingId,
      })

      return ApiSuccess.created({ id: agenda.id }, '안건이 추가되었습니다.')
    },
    '/api/board-room/agendas',
    { userId: user.id }
  )
}
