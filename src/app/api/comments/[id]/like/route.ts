export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { createSupabaseServer } from '@/lib/supabase/server'
import rateLimiterUtils from '@/utils/rateLimiter'
import { validateUUID } from '@/utils/validation'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    // Rate limiting
    const rateLimitConfig = rateLimiterUtils.RATE_LIMIT_CONFIGS.AUTH_API
    const rateLimiter = await rateLimiterUtils.applyRateLimit(rateLimitConfig)
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return createErrorResponse({ success: false, error: '요청이 너무 많습니다.' }, 429)
    }

    const commentId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(commentId, '댓글 ID')
    if (!uuidValidation.isValid) {
      return NextResponse.json(
        { error: uuidValidation.errors[0] || '잘못된 댓글 ID 형식입니다.' },
        { status: 400 }
      )
    }
    const validCommentId = uuidValidation.sanitized

    // 표준 인증 패턴: 쿠키 기반 세션 확인
    const supabase = await createSupabaseServer()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    }

    // 사용자가 승인된 회원인지 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (
      profileError ||
      !profile ||
      profile.registration_status !== 'approved' ||
      !profile.is_active
    ) {
      return NextResponse.json(
        { error: '승인된 회원만 댓글에 좋아요를 누를 수 있습니다.' },
        { status: 403 }
      )
    }

    // 댓글이 존재하는지 확인
    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .select('id')
      .eq('id', validCommentId)
      .single()

    if (commentError || !comment) {
      return createErrorResponse({ success: false, error: '댓글을 찾을 수 없습니다.' }, 404)
    }

    // 좋아요 토글 실행
    const { data: result, error: toggleError } = await supabase.rpc('toggle_comment_like', {
      p_comment_id: validCommentId,
      p_user_id: user.id,
    })

    if (toggleError) {
      console.error('댓글 좋아요 토글 오류:', toggleError)
      return createErrorResponse(
        { success: false, error: '좋아요 처리 중 오류가 발생했습니다.' },
        500
      )
    }

    const likeResult = result?.[0]
    if (!likeResult) {
      return createErrorResponse(
        { success: false, error: '좋아요 처리 결과를 받을 수 없습니다.' },
        500
      )
    }

    return NextResponse.json({
      success: true,
      liked: likeResult.liked,
      like_count: likeResult.like_count,
    })
  } catch (error) {
    console.error('댓글 좋아요 API 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}
