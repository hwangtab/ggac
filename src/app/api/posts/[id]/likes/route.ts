/**
 * 게시글 좋아요 관리 API
 * GET: 게시글 좋아요 정보 조회
 * POST: 좋아요 추가/제거 (토글)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import type { PostLikeToggleResponse, PostLikedUser } from '@/types'

// Rate limiting 설정
const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('post_likes')
})

/**
 * 게시글 좋아요 정보 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Rate limiting 적용
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const postId = params.id
    const { searchParams } = new URL(request.url)
    const includeUsers = searchParams.get('include_users') === 'true'
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)

    // 게시글 존재 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, like_count')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 현재 사용자의 좋아요 여부 확인
    const { data: userLike } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', session.user.id)
      .single()

    const result: any = {
      post_id: postId,
      like_count: post.like_count || 0,
      is_liked: !!userLike
    }

    // 좋아요한 사용자 목록 포함 (요청 시)
    if (includeUsers) {
      const { data: likedUsers, error: usersError } = await supabase
        .rpc('get_post_likes', {
          p_post_id: postId,
          p_limit: limit,
          p_offset: 0
        })

      if (usersError) {
        console.error('좋아요 사용자 조회 오류:', usersError)
      } else {
        result.liked_users = likedUsers || []
      }
    }

    return NextResponse.json(result)

  } catch (error) {
    console.error('좋아요 정보 조회 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * 게시글 좋아요 토글 (추가/제거)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Rate limiting 적용 (좀 더 엄격하게)
    const strictRateLimiter = applyRateLimit({
      maxRequests: 30, // 분당 30회로 제한
      windowMs: 60 * 1000, // 1분
      keyGenerator: createUserKeyGenerator('post_like_toggle')
    })
    
    const rateLimitResult = strictRateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 사용자 승인 상태 확인
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (!profile || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json({ error: '승인된 회원만 좋아요를 할 수 있습니다.' }, { status: 403 })
    }

    const postId = params.id

    // 게시글 존재 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, is_deleted')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    }

    if (post.is_deleted) {
      return NextResponse.json({ error: '삭제된 게시글에는 좋아요를 할 수 없습니다.' }, { status: 400 })
    }

    // 좋아요 토글 실행
    const { data: toggleResult, error: toggleError } = await supabase
      .rpc('toggle_post_like', {
        p_post_id: postId,
        p_user_id: session.user.id
      })

    if (toggleError) {
      console.error('좋아요 토글 오류:', toggleError)
      return NextResponse.json({ error: '좋아요 처리에 실패했습니다.' }, { status: 500 })
    }

    const result = toggleResult?.[0]
    if (!result) {
      return NextResponse.json({ error: '좋아요 처리 결과를 확인할 수 없습니다.' }, { status: 500 })
    }

    const response: PostLikeToggleResponse = {
      liked: result.liked,
      like_count: result.like_count,
      message: result.liked ? '좋아요를 추가했습니다.' : '좋아요를 취소했습니다.'
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('좋아요 토글 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * 게시글 좋아요한 사용자 목록 조회 (관리자용)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 관리자 권한 확인
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin')
      .eq('id', session.user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    const postId = params.id
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')

    if (!userId) {
      return NextResponse.json({ error: 'user_id 파라미터가 필요합니다.' }, { status: 400 })
    }

    // 특정 사용자의 좋아요 삭제
    const { error: deleteError } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId)

    if (deleteError) {
      console.error('좋아요 삭제 오류:', deleteError)
      return NextResponse.json({ error: '좋아요 삭제에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({ message: '좋아요가 삭제되었습니다.' })

  } catch (error) {
    console.error('좋아요 삭제 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}