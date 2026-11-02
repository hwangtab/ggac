/**
 * 타임뱅크 글 댓글 — 목록(GET)과 작성(POST). 약속·일정은 여기서 정한다(스펙 §5).
 *
 * - 읽기: `requireTimebankReader`(꺼져도 읽는다, §7.2)
 * - 쓰기: `requireTimebankParticipant` + 사용자 키 레이트리밋(30/시간)
 * - 댓글 스위치(`comment_features`)를 내리면 함께 멈춘다(장터와 같다).
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  requireTimebankParticipant,
  requireTimebankReader,
  timebankRateLimit,
} from '@/lib/server/timebankAuth'
import { applyRouteRateLimit } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { FEATURE_DISABLED_MESSAGES, isCommentsEnabled } from '@/lib/features/settings'
import { notifyTimebankComment } from '@/lib/server/timebankNotify'
import { TIMEBANK_COMMENT_MAX } from '@/constants/timebank'
import {
  createTimebankComment,
  getTimebankListingOwner,
  listTimebankCommenterIds,
  listTimebankComments,
} from '@/db/queries/timebankBoard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const NOT_FOUND = '글을 찾을 수 없습니다.'

async function readListingId(context: RouteContext) {
  const { id } = await context.params
  const validation = validateUUID(id, '글 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 글 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      const owner = await getTimebankListingOwner(listingId)
      if (!owner) throw ApiError.notFound(NOT_FOUND)
      const comments = await listTimebankComments(listingId)
      return ApiSuccess.ok({ comments })
    },
    `/api/timebank/listings/${listingId}/comments`,
    { userId: user.id }
  )
}

export async function POST(request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireTimebankParticipant()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // 글 경로가 아니라 사람으로 센다 — 경로로 나누면 "글마다 30회"가 된다.
  const rl = await applyRouteRateLimit(request, timebankRateLimit('comment', user.id))
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  if ((await isCommentsEnabled()) === false) {
    return ApiError.serviceUnavailable(FEATURE_DISABLED_MESSAGES.comments).toNextResponse()
  }

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (!content) throw ApiError.badRequest('내용을 입력해 주세요.')
      if (content.length > TIMEBANK_COMMENT_MAX) {
        throw ApiError.badRequest(`댓글은 ${TIMEBANK_COMMENT_MAX}자를 넘을 수 없습니다.`)
      }

      const owner = await getTimebankListingOwner(listingId)
      if (!owner) throw ApiError.notFound(NOT_FOUND)

      // 알림 대상은 **쓰기 전** 명단이다(장터와 같은 이유).
      const priorCommenterIds = await listTimebankCommenterIds(listingId)
      const comment = await createTimebankComment({ listingId, authorId: user.id, content })

      await notifyTimebankComment({
        listingId,
        listingTitle: owner.title,
        authorId: owner.author_id,
        commentId: comment.id,
        actorId: user.id,
        priorCommenterIds,
      })

      return ApiSuccess.created({ id: comment.id }, '댓글이 등록되었습니다.')
    },
    `/api/timebank/listings/${listingId}/comments`,
    { userId: user.id }
  )
}
