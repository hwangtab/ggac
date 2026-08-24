export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { getCommentById } from '@/db/queries/comments'
import { toggleCommentLike } from '@/db/queries/likes'
import rateLimiterUtils from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { requireActiveMember } from '@/lib/server/memberAuth'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    // Rate limiting
    const rateLimitConfig = rateLimiterUtils.RATE_LIMIT_CONFIGS.AUTH_API
    const rateLimiter = await rateLimiterUtils.applyRateLimit(rateLimitConfig)
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
    }

    const commentId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(commentId, '댓글 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 댓글 ID 형식입니다.'
      ).toNextResponse()
    }
    const validCommentId = uuidValidation.sanitized

    // 댓글 좋아요는 로그인 + 승인된 활성 멤버만 가능한 강제 검사였다.
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 댓글이 존재하는지 확인
    const comment = await getCommentById(validCommentId)
    if (!comment) {
      return ApiError.notFound('댓글을 찾을 수 없습니다.').toNextResponse()
    }

    // 좋아요 토글 실행 — toggle_comment_like RPC 대체. 카운트는 매번
    // COUNT(*)로 재계산한다(단계 2c: 원본은 ±1 트리거만 있었지만, 결함을
    // 새 코드에 들여오지 않는다).
    const likeResult = await toggleCommentLike(validCommentId, user.id)

    return ApiSuccess.ok({
      liked: likeResult.liked,
      like_count: likeResult.like_count,
    }).toNextResponse()
  } catch (error) {
    console.error('댓글 좋아요 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
