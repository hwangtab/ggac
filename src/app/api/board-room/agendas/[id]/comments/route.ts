import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardDiscussionWriter, requireBoardRecordReader } from '@/lib/server/boardRoomAuth'
import { MAX_AGENDA_COMMENT_LENGTH } from '@/constants/boardRoom'
import { notifyAgendaDiscussion } from '@/lib/server/boardRoomNotify'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { createLogger } from '@/utils/logger'
import { applyRouteRateLimit, createIPKeyGenerator, RATE_LIMITS } from '@/lib/server/rateLimit'
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
  // 안건 토론은 안건의 일부라 조합원도 읽는다. 작성(POST)도 같은 기준이다 —
  // 아래 `requireBoardDiscussionWriter`가 승인·활성 조합원까지 통과시킨다.
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

  // 조합원 전체에게 열린 쓰기 경로다. 이사 20여 명만 닿던 때는 길이 상한으로
  // 충분했지만, 이제 승인 계정 하나로 반복 호출하면 댓글마다 참여자 전원에게
  // 알림이 나간다 — 게시판 댓글(`posts/[id]/comments`)과 같은 창(분당 5회)을 쓴다.
  //
  // **키에 이 기능만의 이름을 붙인다.** 설정별 네임스페이스(`name`)가 생긴
  // 뒤로 `POST_CREATION`을 그대로 쓰면 게시판 글쓰기와 같은 통
  // (`rate_limit:post_creation:<ip>`)을 나눠 쓴다 — 글 다섯 개를 올린 조합원이
  // 이사회 의견 첫 줄에서 막힌다. 성격이 다른 두 행동이라 통을 나눈다.
  //
  // 경로가 아니라 IP + 기능으로 나눈다 — 경로로 나누면 `[id]`가 키에 들어가
  // "안건마다 5회"가 되어 안건 수만큼 곱해진다.
  const rl = await applyRouteRateLimit(request, {
    ...RATE_LIMITS.POST_CREATION,
    message: '의견을 너무 빠르게 남기고 있습니다. 잠시 후 다시 시도해주세요.',
    keyGenerator: createIPKeyGenerator('board-discussion'),
  })
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  // 토론 참여는 조합원 전체에게 열려 있다(읽기와 같은 기준: 승인·활성).
  // 이사회 전용 쓰기는 여전히 `requireBoardMember`다.
  const auth = await requireBoardDiscussionWriter()
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

      // 이름을 못 읽어도 댓글은 남는다. 다만 알림 문구가 "조합원 님이"로
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
        actorName: actorName ?? '조합원',
      })

      return ApiSuccess.created({ id: comment.id }, '의견이 등록되었습니다.')
    },
    `/api/board-room/agendas/${agendaId}/comments`,
    { userId: user.id }
  )
}
