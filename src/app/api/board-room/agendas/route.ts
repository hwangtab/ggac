import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { notifyDirectors } from '@/lib/server/boardRoomNotify'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth

  return apiPost(
    async () => {
      const body = await request.json()
      const meetingId: string = body.meeting_id
      const title: string = (body.title || '').trim()
      const content: string | null = body.content || null
      if (!meetingId || !title) throw ApiError.badRequest('meeting_id와 제목이 필요합니다.')

      const { data: lastRow, error: lastErr } = await db
        .from('board_agendas')
        .select('sort_order')
        .eq('meeting_id', meetingId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastErr) throw ApiError.internalServerError('안건 순서를 조회할 수 없습니다.')
      const nextOrder = (lastRow?.sort_order ?? -1) + 1

      const { data: agenda, error } = await db
        .from('board_agendas')
        .insert({
          meeting_id: meetingId,
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
        .eq('id', meetingId)
        .single()
      await notifyDirectors(db, {
        title: '새 안건 등록',
        message: `'${meeting?.title ?? '이사회'}'에 새 안건이 등록되었습니다: ${title}`,
        meetingId,
      })

      return ApiSuccess.created({ id: agenda.id }, '안건이 추가되었습니다.')
    },
    '/api/board-room/agendas',
    { userId: user.id }
  )
}
