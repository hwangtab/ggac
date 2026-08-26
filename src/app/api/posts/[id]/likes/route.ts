/**
 * 게시글 좋아요 관리 API
 * GET: 게시글 좋아요 정보 조회
 * POST: 좋아요 추가/제거 (토글)
 * Next.js App Router API Route
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'
import { getPostById } from '@/db/queries/posts'
import { isPostLikedByUser, togglePostLike } from '@/db/queries/likes'
import { logUserActivity } from '@/db/queries/activities'
import type { PostLikeToggleResponse } from '@/types'
import { validateUUID } from '@/utils/validation'
import { requireUser, requireActiveMember } from '@/lib/server/memberAuth'

/**
 * 게시글 좋아요 정보 조회
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const resolvedParams = await context.params
    const postId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }
    const validPostId = uuidValidation.sanitized

    // 좋아요 조회는 로그인만 확인한다(승인 여부는 보지 않음).
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 게시글 존재 확인 — 원본은 is_deleted를 걸러내지 않았다(삭제된 글도
    // 좋아요 정보 조회는 계속 됐다).
    const post = await getPostById(validPostId, { includeDeleted: true })

    if (!post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    // 현재 사용자의 좋아요 여부 확인
    const isLiked = await isPostLikedByUser(validPostId, user.id)

    return ApiSuccess.ok({
      post_id: validPostId,
      like_count: post.like_count || 0,
      is_liked: isLiked,
    }).toNextResponse()
  } catch (error) {
    console.error('[API] GET /likes 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

/**
 * 게시글 좋아요 토글 (추가/제거)
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // 좋아요 토글 무한 반복 방지 (전수감사 안정성 M-4)
  const rl = await rateLimit(request, 'GENERAL_API')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  try {
    const resolvedParams = await context.params
    const postId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }
    const validPostId = uuidValidation.sanitized

    // 좋아요 토글은 로그인 + 승인된 활성 멤버만 가능한 강제 검사였다.
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 게시글 존재 확인
    const post = await getPostById(validPostId, { includeDeleted: true })

    if (!post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    if (post.is_deleted) {
      return ApiError.badRequest('삭제된 게시글에는 좋아요를 할 수 없습니다.').toNextResponse()
    }

    // 좋아요 토글 실행 — toggle_post_like RPC 대체. 카운트는 트랜잭션 안에서
    // 매번 COUNT(*)로 재계산한다(단계 2c, 브리프 결함 1번 — +1/-1 증감 금지).
    const result = await togglePostLike(validPostId, user.id)

    // 활동 로깅 — 단계 4에서 Turso 쿼리 계층(logUserActivity)으로 옮겼다.
    // 실패해도 좋아요 토글(본 작업)을 막지 않는다(activities.ts 모듈 설명,
    // 브리프 필수 조건 1번) — 대신 조용히 삼키지 않고 로그를 남긴다.
    try {
      await logUserActivity({
        user_id: user.id,
        action_type: result.liked ? 'like_added' : 'like_removed',
        target_type: 'post',
        target_id: validPostId,
        metadata: {
          post_title: post.title,
          action: result.liked ? 'add' : 'remove',
        },
      })
    } catch (logError) {
      console.error('좋아요 활동 로깅 실패:', logError)
      // 로깅 실패가 좋아요 기능을 방해하지 않도록 함
    }

    const payload: PostLikeToggleResponse = {
      liked: result.liked,
      like_count: result.like_count,
      message: result.liked ? '좋아요를 추가했습니다.' : '좋아요를 취소했습니다.',
    }

    return ApiSuccess.ok(payload).toNextResponse()
  } catch (error) {
    console.error('[API] POST /likes 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
