/**
 * 개별 게시글 조회 API
 * 좋아요 정보를 포함한 게시글 상세 정보 제공
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import distributedRateLimiter, { DISTRIBUTED_RATE_LIMIT_CONFIGS, createDistributedUserKeyGenerator } from '@/utils/distributedRateLimiter'
import { validateUUID } from '@/utils/validation'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await context.params;
  const postId = resolvedParams.id;
  
  try {
    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID');
    if (!uuidValidation.isValid) {
      console.log('[API] POST 상세 UUID 검증 실패:', uuidValidation.errors);
      return NextResponse.json({ 
        error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.' 
      }, { status: 400 });
    }
    
    // 분산 Rate limiting 적용
    const rateLimiter = await distributedRateLimiter.applyRateLimit({
      ...DISTRIBUTED_RATE_LIMIT_CONFIGS.GENERAL_API,
      keyGenerator: createDistributedUserKeyGenerator('post_detail')
    })
    
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const supabase = createRouteHandlerClient({ cookies })
    // 세션은 선택 사항(공개 열람 허용), 사용자 ID가 있으면 is_liked 등 계산에 사용
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id || null
    let isAdmin = false
    if (userId) {
      const { data: prof } = await supabase
        .from('member_profiles')
        .select('is_admin')
        .eq('id', userId)
        .single()
      isAdmin = !!prof?.is_admin
    }

    const validPostId = uuidValidation.sanitized
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
        content_format,
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
      .eq('id', validPostId)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: '게시글을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 삭제된 게시글 접근 권한 확인
    if (post.is_deleted && !(isAdmin || (userId && post.author_id === userId))) {
      return NextResponse.json({ error: '삭제된 게시글입니다.' }, { status: 404 })
    }

    // 현재 사용자의 좋아요 상태 확인(선택)
    let isLiked = false
    if (userId) {
      const { data: userLike } = await supabase
        .from('post_likes')
        .select('id')
        .eq('post_id', validPostId)
        .eq('user_id', userId)
        .maybeSingle()
      isLiked = !!userLike
    }

    // 댓글 수 조회
    const { count: commentCount } = await supabase
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', validPostId)

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
            display_name
          )
        `)
        .eq('post_id', validPostId)
        .order('created_at', { ascending: true })

      if (commentsError) {
        console.error('댓글 조회 오류:', commentsError)
      } else {
        comments = commentsData || []
        // 댓글 좋아요 메타 병합(집계 + 사용자 좋아요)
        const ids = comments.map((c: any) => c.id)
        if (ids.length > 0) {
          // 집계: 댓글별 좋아요 수
          const { data: likeRows } = await supabase
            .from('comment_likes')
            .select('comment_id')
            .in('comment_id', ids)
          const likeCountMap = new Map<string, number>()
          likeRows?.forEach((r: any) => {
            likeCountMap.set(r.comment_id, (likeCountMap.get(r.comment_id) || 0) + 1)
          })
          let userLikedSet: Set<string> | null = null
          if (userId) {
            const { data: userLiked } = await supabase
              .from('comment_likes')
              .select('comment_id')
              .in('comment_id', ids)
              .eq('user_id', userId)
            userLikedSet = new Set((userLiked || []).map((x: any) => x.comment_id))
          }
          comments = comments.map((c: any) => ({
            ...c,
            like_count: likeCountMap.get(c.id) || 0,
            is_liked: userLikedSet ? userLikedSet.has(c.id) : false,
          }))
        }
      }
    }

    // 첨부파일 목록 조회 (요청 시)
    let attachments: any[] = []
    if (includeAttachments) {
      const { data: attachmentsData, error: attachmentsError } = await supabase
        .from('post_attachments')
        .select('*')
        .eq('post_id', validPostId)
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
