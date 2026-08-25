export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/lib/server/rateLimit'
import { parseIntegerParam } from '@/utils/queryParams'
import { validateUUID } from '@/utils/validation'
import { createLogger, maskId } from '@/utils/logger'
import { getOptionalUser } from '@/lib/server/memberAuth'
import { getPostById, incrementViewCount } from '@/db/queries/posts'
import { logUserActivity } from '@/db/queries/activities'

const log = createLogger('api/posts/view')

/**
 * 게시글 조회수 증가 API
 * POST /api/posts/[id]/view
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    const postId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      log.debug('VIEW UUID validation failed', { postId: maskId(postId) })
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }

    // Rate limiting 적용
    const rateLimiter = await applyRateLimit(RATE_LIMIT_CONFIGS.GENERAL_API)
    const rateLimitResult = await rateLimiter(request)

    if (!rateLimitResult.success) {
      return (
        rateLimitResult.response ??
        ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
      )
    }

    const validPostId = uuidValidation.sanitized

    // 사용자 세션 확인 (선택사항 - 비로그인 사용자도 조회 가능)
    // 로그인 여부에 따라 작성자 본인 조회 제외·활동 로그 기록 등을 얹는
    // 선택적 조회다. 비로그인도 조회수를 증가시킬 수 있어야 하므로
    // requireUser로 바꾸지 않는다.
    const user = await getOptionalUser()
    const userId = user?.id

    // 게시글 존재 여부 및 작성자 확인. 단계 2c(Task 5): Supabase
    // `.eq('id', validPostId).eq('is_deleted', false)`에서 Turso 쿼리 계층
    // getPostById(validPostId, { includeDeleted: false })로 옮겼다 — 응답에
    // 필요한 id/title/author_id/view_count는 전부 PostFields에 그대로 있다.
    const post = await getPostById(validPostId, { includeDeleted: false }).catch(() => null)

    if (!post) {
      return ApiError.notFound('Post not found').toNextResponse()
    }

    // 작성자 본인은 조회수 증가시키지 않음
    if (userId && post.author_id === userId) {
      return ApiSuccess.ok(
        { view_count: post.view_count },
        'Author view - count not incremented'
      ).toNextResponse()
    }

    // 중복 조회 방지를 위한 세션 체크
    const lastViewTime = request.headers.get('x-last-view-time')

    // 최근 10분 내 같은 게시글을 본 경우 조회수 증가하지 않음
    if (lastViewTime) {
      const timeDiff = Date.now() - parseIntegerParam(lastViewTime, 0, { min: 0 })
      if (timeDiff < 10 * 60 * 1000) {
        // 10분
        return ApiSuccess.ok(
          { view_count: post.view_count },
          'Recent view - count not incremented'
        ).toNextResponse()
      }
    }

    // 조회수 증가. 단계 2c(Task 5): Supabase RPC `increment_post_view_count`
    // 대신 Turso 쿼리 계층 incrementViewCount(validPostId)를 쓴다 — 내부는
    // `UPDATE posts SET view_count = view_count + 1 WHERE id = ?` 단일
    // 문이라 읽고-쓰기 왕복이 없다(동시 조회에서 유실되지 않는다).
    const newViewCount = await incrementViewCount(validPostId).catch(error => {
      console.error('조회수 증가 오류:', error)
      return null
    })

    if (newViewCount === null) {
      return ApiError.internalServerError('Failed to increment view count').toNextResponse()
    }

    // 활동 로그 기록 (로그인한 사용자만) — 단계 4: Turso 쿼리 계층
    // (logUserActivity)으로 옮겼다. 실패해도 조회수 증가(본 작업)를 막지
    // 않는다(activities.ts 모듈 설명, 브리프 필수 조건 1번).
    if (userId) {
      try {
        await logUserActivity({
          user_id: userId,
          action_type: 'page_viewed',
          target_type: 'post',
          target_id: validPostId,
          metadata: {
            post_title: post.title,
            view_count: newViewCount,
          },
        })
      } catch (activityError) {
        // 활동 로그 실패는 조회수 증가를 막지 않음
        console.warn('활동 로그 기록 실패:', activityError)
      }
    }

    // 응답에 조회 시간 포함 (클라이언트에서 중복 방지용)
    return ApiSuccess.ok({ view_count: newViewCount }, 'View count incremented').toNextResponse({
      extraHeaders: { 'x-view-time': Date.now().toString() },
    })
  } catch (error) {
    console.error('게시글 조회 추적 오류:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}

/**
 * 게시글 조회수 조회 API
 * GET /api/posts/[id]/view
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    const postId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      log.debug('VIEW GET UUID validation failed', { postId: maskId(postId) })
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }

    const validPostId = uuidValidation.sanitized

    // 게시글 조회수 조회. 단계 2c(Task 5): Supabase
    // `.eq('id', validPostId).eq('is_deleted', false)`에서 Turso 쿼리 계층
    // getPostById(validPostId, { includeDeleted: false })로 옮겼다.
    const post = await getPostById(validPostId, { includeDeleted: false })

    if (!post) {
      return ApiError.notFound('Post not found').toNextResponse()
    }

    return ApiSuccess.ok({ view_count: post.view_count || 0 }).toNextResponse()
  } catch (error) {
    console.error('게시글 조회수 조회 오류:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
