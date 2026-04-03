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
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import type { PostLikeToggleResponse } from '@/types'
import { validateUUID } from '@/utils/validation'

/**
 * 게시글 좋아요 정보 조회
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  console.log('🟢 [API] GET 라우트 진입')

  try {
    const resolvedParams = await context.params
    const postId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      console.log('[API] GET UUID 검증 실패:', uuidValidation.errors)
      return NextResponse.json(
        {
          error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.',
        },
        { status: 400 }
      )
    }

    console.log('[API] GET /api/posts/[id]/likes 시작', {
      postId: uuidValidation.sanitized,
      timestamp: new Date().toISOString(),
    })

    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.log('[API] GET 인증 실패')
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 게시글 존재 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, like_count')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      console.log('[API] GET 게시글 없음:', postError)
      return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 현재 사용자의 좋아요 여부 확인
    const { data: userLike } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .single()

    const result = {
      post_id: postId,
      like_count: post.like_count || 0,
      is_liked: !!userLike,
    }

    console.log('[API] GET 성공:', result)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[API] GET 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * 게시글 좋아요 토글 (추가/제거)
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  console.log('🟢 [API] POST 라우트 진입')

  try {
    const resolvedParams = await context.params
    const postId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      console.log('[API] POST UUID 검증 실패:', uuidValidation.errors)
      return NextResponse.json(
        {
          error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.',
        },
        { status: 400 }
      )
    }

    console.log('[API] POST /api/posts/[id]/likes 시작', {
      postId: uuidValidation.sanitized,
      timestamp: new Date().toISOString(),
    })

    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.log('[API] POST 인증 실패')
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    console.log('[API] 인증 성공:', user.email)

    // 사용자 승인 상태 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('[API] 프로필 조회 오류:', profileError)
      return NextResponse.json({ error: '회원 정보를 확인할 수 없습니다.' }, { status: 500 })
    }

    if (!profile || profile.registration_status !== 'approved' || !profile.is_active) {
      console.log('[API] 승인되지 않은 사용자:', profile)
      return NextResponse.json({ error: '승인된 회원만 좋아요를 할 수 있습니다.' }, { status: 403 })
    }

    // 게시글 존재 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, is_deleted, title')
      .eq('id', uuidValidation.sanitized)
      .single()

    if (postError || !post) {
      console.error('[API] 게시글 조회 오류:', postError)
      return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    }

    if (post.is_deleted) {
      console.log('[API] 삭제된 게시글')
      return NextResponse.json(
        { error: '삭제된 게시글에는 좋아요를 할 수 없습니다.' },
        { status: 400 }
      )
    }

    // 좋아요 토글 실행
    console.log('[API] toggle_post_like RPC 호출')
    const { data: toggleResult, error: toggleError } = await supabase.rpc('toggle_post_like', {
      p_post_id: uuidValidation.sanitized,
      p_user_id: user.id,
    })

    if (toggleError) {
      console.error('[API] RPC 오류 상세:', {
        message: toggleError.message,
        details: toggleError.details,
        hint: toggleError.hint,
        code: toggleError.code,
      })
      return NextResponse.json(
        {
          error: '좋아요 처리에 실패했습니다.',
          details: toggleError.message,
        },
        { status: 500 }
      )
    }

    const result = toggleResult?.[0]
    if (!result) {
      console.error('[API] RPC 결과 없음')
      return NextResponse.json({ error: '좋아요 처리 결과를 확인할 수 없습니다.' }, { status: 500 })
    }

    // 활동 로깅
    try {
      await supabase.rpc('log_user_activity', {
        p_user_id: user.id,
        p_action_type: result.liked ? 'like_added' : 'like_removed',
        p_target_type: 'post',
        p_target_id: uuidValidation.sanitized,
        p_details: JSON.stringify({
          post_title: post.title,
          action: result.liked ? 'add' : 'remove',
        }),
      })
    } catch (logError) {
      console.error('좋아요 활동 로깅 실패:', logError)
      // 로깅 실패가 좋아요 기능을 방해하지 않도록 함
    }

    const response: PostLikeToggleResponse = {
      liked: result.liked,
      like_count: result.like_count,
      message: result.liked ? '좋아요를 추가했습니다.' : '좋아요를 취소했습니다.',
    }

    console.log('[API] POST 성공:', response)
    return NextResponse.json(response)
  } catch (error) {
    console.error('[API] POST 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * 헬스 체크 (관리자용)
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  console.log('🟢 [API] DELETE 라우트 진입 (헬스체크)')

  try {
    const resolvedParams = await context.params
    const postId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      console.log('[API] DELETE UUID 검증 실패:', uuidValidation.errors)
      return NextResponse.json(
        {
          error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.',
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      status: 'healthy',
      postId: uuidValidation.sanitized,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[API] DELETE 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
