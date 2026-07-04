export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/lib/server/rateLimit'
import { parseIntegerParam } from '@/utils/queryParams'
import { validateUUID } from '@/utils/validation'
import { createLogger, maskId } from '@/utils/logger'

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

    const supabase = await createSupabaseServer()

    // 사용자 세션 확인 (선택사항 - 비로그인 사용자도 조회 가능)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id

    let serviceSupabase
    try {
      serviceSupabase = createServiceRoleClient()
    } catch {
      return ApiError.internalServerError('Server configuration error').toNextResponse()
    }

    // 게시글 존재 여부 및 작성자 확인
    const { data: post, error: postError } = await serviceSupabase
      .from('posts')
      .select('id, title, author_id, view_count')
      .eq('id', validPostId)
      .eq('is_deleted', false)
      .single()

    if (postError || !post) {
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

    // 조회수 증가 (데이터베이스 함수 사용)
    const { data: result, error: incrementError } = await serviceSupabase.rpc(
      'increment_post_view_count',
      { post_uuid: validPostId }
    )

    if (incrementError) {
      console.error('조회수 증가 오류:', incrementError)
      return ApiError.internalServerError('Failed to increment view count').toNextResponse()
    }

    const newViewCount = result || post.view_count + 1

    // 활동 로그 기록 (로그인한 사용자만)
    if (userId) {
      try {
        await serviceSupabase.from('user_activities').insert({
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

    const supabase = await createSupabaseServer()

    // 게시글 조회수 조회
    const { data: post, error } = await supabase
      .from('posts')
      .select('view_count')
      .eq('id', validPostId)
      .eq('is_deleted', false)
      .single()

    if (error || !post) {
      return ApiError.notFound('Post not found').toNextResponse()
    }

    return ApiSuccess.ok({ view_count: post.view_count || 0 }).toNextResponse()
  } catch (error) {
    console.error('게시글 조회수 조회 오류:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
