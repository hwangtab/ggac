import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember, requireBoardRecordReader } from '@/lib/server/boardRoomAuth'
import { MAX_AGENDA_COMMENT_LENGTH } from '@/constants/boardRoom'
import { notifyAgendaDiscussion } from '@/lib/server/boardRoomNotify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { createLogger } from '@/utils/logger'
import {
  createAgendaComment,
  getAgendaContext,
  listAgendaParticipants,
  listCommentsByAgenda,
} from '@/db/queries/boardAgendaComments'
import { getProfileDisplayName } from '@/db/queries/profiles'

export const runtime = 'nodejs'

const log = createLogger('boardAgendaComments')

function validateAgendaId(id: string) {
  const validation = validateUUID(id, '안건 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 안건 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const routeId = validateAgendaId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const agendaId = routeId.id
  // 안건 토론은 안건의 일부라 조합원도 읽는다. 작성(POST)은 아래에서 그대로
  // 이사·감사·관리자만 통과한다.
  const auth = await requireBoardRecordReader()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      const agenda = await getAgendaContext(agendaId)
      if (!agenda) throw ApiError.notFound('안건을 찾을 수 없습니다.')

      let comments: Awaited<ReturnType<typeof listCommentsByAgenda>>
      try {
        comments = await listCommentsByAgenda(agendaId)
      } catch {
        throw ApiError.internalServerError('토론을 불러올 수 없습니다.')
      }

      return ApiSuccess.ok({ comments })
    },
    `/api/board-room/agendas/${agendaId}/comments`,
    { userId: user.id }
  )
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const routeId = validateAgendaId(params.id)
  if (routeId.error) return routeId.error.toNextResponse()
  const agendaId = routeId.id
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (!content) throw ApiError.badRequest('내용을 입력해 주세요.')
      if (content.length > MAX_AGENDA_COMMENT_LENGTH) {
        throw ApiError.badRequest(`내용은 ${MAX_AGENDA_COMMENT_LENGTH}자를 넘을 수 없습니다.`)
      }

      const agenda = await getAgendaContext(agendaId)
      if (!agenda) throw ApiError.notFound('안건을 찾을 수 없습니다.')

      // 알림 대상은 **쓰기 전** 참여자 명단이어야 한다. 방금 넣은 내 댓글까지
      // 세면 나 자신이 대상에 들어왔다가 다시 걸러지는 낭비가 생긴다.
      const participantIds = await listAgendaParticipants(agendaId)

      let comment: { id: string }
      try {
        comment = await createAgendaComment({ agendaId, authorId: user.id, content })
      } catch {
        throw ApiError.internalServerError('의견 등록에 실패했습니다.')
      }

      // 이름을 못 읽어도 댓글은 남는다. 다만 알림 문구가 "이사 님이"로
      // 뭉개지므로 원인을 남긴다 — 조용히 익명이 되면 아무도 눈치채지 못한다.
      const actorName = await getProfileDisplayName(user.id).catch(e => {
        log.warn('작성자 이름 조회 실패 — 토론 알림이 익명으로 나간다', {
          userId: user.id,
          error: (e as Error).message,
        })
        return null
      })
      await notifyAgendaDiscussion({
        meetingId: agenda.meeting_id,
        agendaId,
        agendaTitle: agenda.title,
        proposedBy: agenda.proposed_by,
        participantIds,
        actorId: user.id,
        actorName: actorName ?? '이사',
      })

      return ApiSuccess.created({ id: comment.id }, '의견이 등록되었습니다.')
    },
    `/api/board-room/agendas/${agendaId}/comments`,
    { userId: user.id }
  )
}
