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
      const content: string = body.content || ''
      const contentFormat: string = body.content_format || 'markdown'
      if (!meetingId) throw ApiError.badRequest('meeting_id가 필요합니다.')

      const { data: existing, error: existErr } = await db
        .from('board_minutes')
        .select('id')
        .eq('meeting_id', meetingId)
        .maybeSingle()
      if (existErr) throw ApiError.internalServerError('회의록 조회에 실패했습니다.')
      if (existing) throw ApiError.conflict('이미 회의록이 존재합니다.')

      const { data: minutes, error } = await db
        .from('board_minutes')
        .insert({ meeting_id: meetingId, content, content_format: contentFormat, author_id: user.id })
        .select('id')
        .single()
      if (error || !minutes) throw ApiError.internalServerError('회의록 생성에 실패했습니다.')

      const { data: meeting } = await db
        .from('board_meetings')
        .select('title')
        .eq('id', meetingId)
        .single()
      await notifyDirectors(db, {
        title: '회의록 작성',
        message: `'${meeting?.title ?? '이사회'}' 회의록이 작성되었습니다.`,
        meetingId,
      })

      return ApiSuccess.created({ id: minutes.id }, '회의록이 작성되었습니다.')
    },
    '/api/board-room/minutes',
    { userId: user.id }
  )
}
