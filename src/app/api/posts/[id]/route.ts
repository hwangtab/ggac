/**
 * 개별 게시글 조회 API
 * 좋아요 정보를 포함한 게시글 상세 정보 제공
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'

// Rate limiting 설정
const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('post_detail')
})

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
    
    // 인증 확인
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 회원 상태 확인
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active, is_admin')
      .eq('id', session.user.id)
      .single()

    if (!profile || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json({ error: '승인된 회원만 접근할 수 있습니다.' }, { status: 403 })
    }

    const postId = params.id
    const { searchParams } = new URL(request.url)
    const includeComments = searchParams.get('include_comments') !== 'false' // 기본적으로 포함
    const includeAttachments = searchParams.get('include_attachments') !== 'false' // 기본적으로 포함

    // 게시글 기본 정보 조회
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select(`
        id,
        title,
        content,
        category,
        author_id,
        created_at,
        updated_at,
        is_deleted,
        is_pinned,
        like_count,
        author:member_profiles!posts_author_id_fkey (
          display_name,
          email
        )
      `)
      .eq('id', postId)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 삭제된 게시글 접근 권한 확인
    if (post.is_deleted && !profile.is_admin && post.author_id !== session.user.id) {
      return NextResponse.json({ error: '삭제된 게시글입니다.' }, { status: 404 })
    }

    // 현재 사용자의 좋아요 상태 확인
    const { data: userLike } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', session.user.id)
      .single()

    const isLiked = !!userLike

    // 댓글 수 조회
    const { count: commentCount } = await supabase
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', postId)

    // 댓글 목록 조회 (요청 시)
    let comments: any[] = []
    if (includeComments) {
      const { data: commentsData, error: commentsError } = await supabase
        .from('comments')
        .select(`
          id,
          content,
          author_id,
          created_at,
          author:member_profiles!comments_author_id_fkey (
            display_name,
            email
          )
        `)
        .eq('post_id', postId)
        .order('created_at', { ascending: true })

      if (commentsError) {
        console.error('댓글 조회 오류:', commentsError)
      } else {
        comments = commentsData || []
      }
    }

    // 첨부파일 목록 조회 (요청 시)
    let attachments: any[] = []
    if (includeAttachments) {
      const { data: attachmentsData, error: attachmentsError } = await supabase
        .from('post_attachments')
        .select('*')
        .eq('post_id', postId)
        .order('sort_order', { ascending: true })

      if (attachmentsError) {
        console.error('첨부파일 조회 오류:', attachmentsError)
      } else {
        attachments = attachmentsData || []
      }
    }

    // 응답 데이터 구성
    const responseData = {
      ...post,
      comment_count: commentCount || 0,
      is_liked: isLiked,
      comments: includeComments ? comments : undefined,
      attachments: includeAttachments ? attachments : undefined
    }

    return NextResponse.json({ post: responseData })

  } catch (error) {
    console.error('게시글 상세 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}