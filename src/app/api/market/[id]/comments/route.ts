/**
 * 장터 매물 댓글 — 목록(GET)과 작성(POST). 거래 문의가 여기로 온다.
 *
 * 읽기·쓰기 모두 승인 조합원이다. 댓글 스위치(`comment_features`)를 내리면
 * 장터 댓글도 멈춘다 — 게시판 댓글과 같은 기능이라 따로 켤 이유가 없다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { applyRouteRateLimit, createIPKeyGenerator, RATE_LIMITS } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { FEATURE_DISABLED_MESSAGES, isCommentsEnabled } from '@/lib/features/settings'
import { notifyMarketComment } from '@/lib/server/marketNotify'
import { MARKET_COMMENT_MAX } from '@/constants/market'
import {
  createMarketComment,
  getMarketListingOwner,
  listMarketCommenterIds,
  listMarketComments,
} from '@/db/queries/market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function readListingId(context: RouteContext) {
  const { id } = await context.params
  const validation = validateUUID(id, '매물 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 매물 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      const owner = await getMarketListingOwner(listingId)
      if (!owner) throw ApiError.notFound('매물을 찾을 수 없습니다.')
      const comments = await listMarketComments(listingId)
      return ApiSuccess.ok({ comments })
    },
    `/api/market/${listingId}/comments`,
    { userId: user.id }
  )
}

export async function POST(request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  // 경로가 아니라 IP + 기능으로 나눈다 — 경로로 나누면 `[id]`가 키에 들어가
  // "매물마다 5회"가 되어 매물 수만큼 곱해진다(`board-room` 토론과 같다).
  const rl = await applyRouteRateLimit(request, {
    ...RATE_LIMITS.POST_CREATION,
    message: '댓글을 너무 빠르게 남기고 있습니다. 잠시 후 다시 시도해주세요.',
    keyGenerator: createIPKeyGenerator('market-comment'),
  })
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  if ((await isCommentsEnabled()) === false) {
    return ApiError.serviceUnavailable(FEATURE_DISABLED_MESSAGES.comments).toNextResponse()
  }

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (!content) throw ApiError.badRequest('내용을 입력해 주세요.')
      if (content.length > MARKET_COMMENT_MAX) {
        throw ApiError.badRequest(`댓글은 ${MARKET_COMMENT_MAX}자를 넘을 수 없습니다.`)
      }

      const owner = await getMarketListingOwner(listingId)
      if (!owner) throw ApiError.notFound('매물을 찾을 수 없습니다.')

      // 알림 대상은 **쓰기 전** 명단이어야 한다 — 방금 단 내 댓글까지 세면
      // 나 자신이 대상에 들어왔다가 다시 걸러진다.
      const priorCommenterIds = await listMarketCommenterIds(listingId)
      const comment = await createMarketComment({ listingId, authorId: user.id, content })

      await notifyMarketComment({
        listingId,
        listingTitle: owner.title,
        sellerId: owner.seller_id,
        commentId: comment.id,
        actorId: user.id,
        priorCommenterIds,
      })

      return ApiSuccess.created({ id: comment.id }, '댓글이 등록되었습니다.')
    },
    `/api/market/${listingId}/comments`,
    { userId: user.id }
  )
}
