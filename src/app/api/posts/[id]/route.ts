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
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import distributedRateLimiter, {
  DISTRIBUTED_RATE_LIMIT_CONFIGS,
  createDistributedUserKeyGenerator,
} from '@/utils/distributedRateLimiter'
import { validateUUID } from '@/utils/validation'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  const postId = resolvedParams.id

  try {
    const timings: Record<string, number> = {}
    const t0 = Date.now()
    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      console.log('[API] POST 상세 UUID 검증 실패:', uuidValidation.errors)
      return NextResponse.json(
        {
          error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.',
        },
        { status: 400 }
      )
    }

    // 분산 Rate limiting 적용
    const rateLimiter = await distributedRateLimiter.applyRateLimit({
      ...DISTRIBUTED_RATE_LIMIT_CONFIGS.GENERAL_API,
      keyGenerator: createDistributedUserKeyGenerator('post_detail'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const supabase = createRouteHandlerClient({ cookies })
    // 세션은 선택 사항(공개 열람 허용), 사용자 ID가 있으면 is_liked 등 계산에 사용
    const {
      data: { session },
    } = await supabase.auth.getSession()
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
    // RLS로 인해 비로그인 시 공개 읽기가 막히는 환경을 대비해
    // 서버에서만 사용하는 서비스 롤 클라이언트를 읽기 전용으로 활용
    const adminClient = (() => {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!url || !key) return null
        return createClient(url, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      } catch {
        return null
      }
    })()
    // 읽기 전용 DB 클라이언트 선택 (좋아요 등 사용자 의존 로직은 supabase 사용)
    const db = userId ? supabase : adminClient || supabase
    const { searchParams } = new URL(request.url)
    const includeComments = searchParams.get('include_comments') !== 'false' // 기본적으로 포함
    const includeAttachments = searchParams.get('include_attachments') !== 'false' // 기본적으로 포함
    const includeContent = searchParams.get('include_content') !== 'false' // 기본 포함, false면 본문 지연 로딩
    const commentsLimit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100)
    const commentsOffset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0)

    // 게시글 기본 정보 조회
    const postStart = Date.now()
    const { data: post, error: postError } = await db
      .from('posts')
      .select(
        `
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
      `
      )
      .eq('id', validPostId)
      .single()

    timings.post_ms = Date.now() - postStart
    if (postError || !post) {
      // 더 자세한 로깅 추가
      console.log(`[API] 게시글 조회 실패 - ID: ${validPostId}`)
      console.log(`[API] 데이터베이스 오류:`, postError)
      console.log(`[API] 게시글 데이터:`, post)
      console.log(`[API] 사용자 ID: ${userId || '비로그인'}`)

      if (postError) {
        console.error(`[API] Supabase 오류 상세:`, {
          code: postError.code,
          message: postError.message,
          details: postError.details,
          hint: postError.hint,
        })
      }

      return NextResponse.json(
        {
          error: '게시글을 찾을 수 없습니다.',
          debug:
            process.env.NODE_ENV === 'development'
              ? {
                  postId: validPostId,
                  hasError: !!postError,
                  errorCode: postError?.code,
                  errorMessage: postError?.message,
                }
              : undefined,
        },
        { status: 404 }
      )
    }

    // 삭제된 게시글 접근 권한 확인
    if (post.is_deleted && !(isAdmin || (userId && post.author_id === userId))) {
      return NextResponse.json({ error: '삭제된 게시글입니다.' }, { status: 404 })
    }

    // 현재 사용자의 좋아요 상태 확인(선택)
    let isLiked = false
    const likeStart = Date.now()
    if (userId) {
      const { data: userLike } = await supabase
        .from('post_likes')
        .select('id')
        .eq('post_id', validPostId)
        .eq('user_id', userId)
        .maybeSingle()
      isLiked = !!userLike
    }
    timings.user_like_ms = Date.now() - likeStart

    // 댓글 수 조회
    const countStart = Date.now()
    const { count: commentCount } = await db
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', validPostId)
    timings.comment_count_ms = Date.now() - countStart

    // 댓글 목록 조회 (요청 시)
    let comments: any[] = []
    if (includeComments) {
      const commentsStart = Date.now()
      const { data: commentsData, error: commentsError } = await db
        .from('comments')
        .select(
          `
          id,
          content,
          author_id,
          created_at,
          like_count,
          author:member_profiles!comments_author_id_fkey (
            display_name
          )
        `
        )
        .eq('post_id', validPostId)
        .order('created_at', { ascending: true })
        .range(commentsOffset, commentsOffset + commentsLimit - 1)

      timings.comments_ms = Date.now() - commentsStart
      if (commentsError) {
        console.error('댓글 조회 오류:', commentsError)
      } else {
        comments = commentsData || []
        // 사용자별 좋아요만 확인(카운트는 comments.like_count 사용)
        const ids = comments.map((c: any) => c.id)
        let userLikedSet: Set<string> | null = null
        if (userId && ids.length > 0) {
          const userLikesStart = Date.now()
          const { data: userLiked } = await supabase
            .from('comment_likes')
            .select('comment_id')
            .in('comment_id', ids)
            .eq('user_id', userId)
          userLikedSet = new Set((userLiked || []).map((x: any) => x.comment_id))
          timings.comment_likes_user_ms = Date.now() - userLikesStart
        }
        comments = comments.map((c: any) => ({
          ...c,
          is_liked: userLikedSet ? userLikedSet.has(c.id) : false,
        }))
      }
    }

    // 첨부파일 목록 조회 (요청 시)
    let attachments: any[] = []
    if (includeAttachments) {
      const attStart = Date.now()
      const { data: attachmentsData, error: attachmentsError } = await db
        .from('post_attachments')
        .select('*')
        .eq('post_id', validPostId)
        .order('sort_order', { ascending: true })
      timings.attachments_ms = Date.now() - attStart

      if (attachmentsError) {
        console.error('첨부파일 조회 오류:', attachmentsError)
      } else {
        attachments = attachmentsData || []
      }
    }

    // 응답 데이터 구성
    const responseData: any = {
      ...post,
      comment_count: commentCount || 0,
      is_liked: isLiked,
      comments: includeComments ? comments : undefined,
      attachments: includeAttachments ? attachments : undefined,
    }
    if (!includeContent) {
      responseData.content = ''
    }

    const total = Date.now() - t0
    if (process.env.POST_DETAIL_TIMING === '1') {
      ;(timings as any).total_ms = total
      return NextResponse.json({ post: responseData, _timings: timings })
    }
    return NextResponse.json({ post: responseData })
  } catch (error) {
    console.error('게시글 상세 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
