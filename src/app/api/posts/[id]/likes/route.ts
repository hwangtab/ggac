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
import { createSupabaseServer } from '@/lib/supabase/server'
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

    const supabase = await createSupabaseServer()

    // 좋아요 조회는 로그인만 확인한다(승인 여부는 보지 않음).
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 게시글 존재 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, like_count')
      .eq('id', validPostId)
      .single()

    if (postError || !post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    // 현재 사용자의 좋아요 여부 확인
    const { data: userLike } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', validPostId)
      .eq('user_id', user.id)
      .single()

    return ApiSuccess.ok({
      post_id: validPostId,
      like_count: post.like_count || 0,
      is_liked: !!userLike,
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

    const supabase = await createSupabaseServer()

    // 좋아요 토글은 로그인 + 승인된 활성 멤버만 가능한 강제 검사였다.
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 게시글 존재 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, is_deleted, title')
      .eq('id', uuidValidation.sanitized)
      .single()

    if (postError || !post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    if (post.is_deleted) {
      return ApiError.badRequest('삭제된 게시글에는 좋아요를 할 수 없습니다.').toNextResponse()
    }

    // 좋아요 토글 실행
    const { data: toggleResult, error: toggleError } = await supabase.rpc('toggle_post_like', {
      p_post_id: uuidValidation.sanitized,
      p_user_id: user.id,
    })

    if (toggleError) {
      console.error('[API] toggle_post_like RPC 오류:', toggleError)
      return ApiError.internalServerError('좋아요 처리에 실패했습니다.').toNextResponse()
    }

    const result = toggleResult?.[0]
    if (!result) {
      console.error('[API] toggle_post_like RPC 결과 없음')
      return ApiError.internalServerError('좋아요 처리 결과를 확인할 수 없습니다.').toNextResponse()
    }

    // 활동 로깅
    try {
      await supabase.rpc('log_user_activity', {
        p_user_id: user.id,
        p_action_type: result.liked ? 'like_added' : 'like_removed',
        p_target_type: 'post',
        p_target_id: uuidValidation.sanitized,
        p_metadata: {
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
