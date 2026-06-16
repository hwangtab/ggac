/**
 * 개별 게시글 조회 API
 * 좋아요 정보를 포함한 게시글 상세 정보 제공
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import distributedRateLimiter, {
  DISTRIBUTED_RATE_LIMIT_CONFIGS,
  createDistributedUserKeyGenerator,
} from '@/utils/distributedRateLimiter'
import { validateUUID } from '@/utils/validation'
import { parseIntegerParam } from '@/utils/queryParams'
import { revalidatePath, revalidateTag } from 'next/cache'
import { CATEGORIES, parseBoardCategory } from '@/constants/categories'
import { parseJsonObjectBody } from '@/utils/requestBody'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  const postId = resolvedParams.id

  try {
    const timings: Record<string, number> = {}
    const t0 = Date.now()
    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      return NextResponse.json(
        { error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.' },
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

    const supabase = await createSupabaseServer()
    // 세션은 선택 사항(공개 열람 허용), 사용자 ID가 있으면 is_liked 등 계산에 사용
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id || null
    let isAdmin = false
    if (userId) {
      const { data: prof } = await supabase
        .from('member_profiles')
        .select('is_admin, registration_status, is_active')
        .eq('id', userId)
        .single()
      isAdmin = !!(prof?.is_admin && prof.registration_status === 'approved' && prof.is_active)
    }

    const validPostId = uuidValidation.sanitized

    /**
     * Service Role 클라이언트 사용 의도 (읽기 전용)
     *
     * 목적: 비로그인 사용자도 공개 게시글을 조회할 수 있도록 RLS 우회
     *
     * 설계 배경:
     * - RLS 정책이 엄격하게 설정된 환경에서, 익명 사용자는 공개 게시글도 읽지 못할 수 있음
     * - 서버 사이드에서 Service Role Key를 사용해 공개 데이터 읽기를 보장
     *
     * 보안 고려사항:
     * - 읽기 전용으로만 사용 (쓰기 작업 없음)
     * - 사용자별 데이터(좋아요 등)는 여전히 createRouteHandlerClient 사용
     * - 대안: RLS 정책을 "공개 게시글은 익명 읽기 허용"으로 수정하는 것이 더 바람직함
     *
     * TODO: RLS 정책 정리 후 adminClient 사용 제거 검토
     */
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

    // 읽기 전용 DB 클라이언트 선택
    // - 로그인 사용자: createRouteHandlerClient (사용자별 데이터 접근)
    // - 비로그인 사용자: adminClient (공개 데이터만 읽기)
    const db = userId ? supabase : adminClient || supabase
    const { searchParams } = new URL(request.url)
    const includeComments = searchParams.get('include_comments') !== 'false' // 기본적으로 포함
    const includeAttachments = searchParams.get('include_attachments') !== 'false' // 기본적으로 포함
    const includeContent = searchParams.get('include_content') !== 'false' // 기본 포함, false면 본문 지연 로딩
    const commentsLimit = parseIntegerParam(searchParams.get('limit'), 30, { min: 1, max: 100 })
    const commentsOffset = parseIntegerParam(searchParams.get('offset'), 0, { min: 0 })

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
      console.error(`[API] 게시글 조회 실패 - ID: ${validPostId}`, postError)
      return createErrorResponse({ success: false, error: '게시글을 찾을 수 없습니다.' }, 404)
    }

    // 삭제된 게시글 접근 권한 확인
    if (post.is_deleted && !(isAdmin || (userId && post.author_id === userId))) {
      return createErrorResponse({ success: false, error: '삭제된 게시글입니다.' }, 404)
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
          like_count: (c as any).like_count ?? 0,
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
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}

/**
 * 게시글 수정
 * PATCH /api/posts/[id]
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  const postId = resolvedParams.id

  try {
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      return NextResponse.json(
        { error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.' },
        { status: 400 }
      )
    }

    const validPostId = uuidValidation.sanitized

    const rateLimiter = await distributedRateLimiter.applyRateLimit({
      ...DISTRIBUTED_RATE_LIMIT_CONFIGS.GENERAL_API,
      keyGenerator: createDistributedUserKeyGenerator('post_update'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return createErrorResponse({ success: false, error: '로그인이 필요합니다.' }, 401)
    }

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', user.id)
      .single()

    const isAdmin = !!(
      profile?.is_admin &&
      profile.registration_status === 'approved' &&
      profile.is_active
    )
    const isApprovedMember = !!(
      profile &&
      profile.registration_status === 'approved' &&
      profile.is_active
    )

    if (!isApprovedMember) {
      return createErrorResponse(
        { success: false, error: '승인된 활성 멤버만 게시글을 수정할 수 있습니다.' },
        403
      )
    }

    const body = await parseJsonObjectBody(request)
    if (!body) {
      return createErrorResponse({ success: false, error: '유효한 JSON body가 필요합니다.' }, 400)
    }

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const content = typeof body.content === 'string' ? body.content : ''
    const contentFormat =
      body.content_format === 'plain' || body.content_format === 'html' ? body.content_format : null
    const category = parseBoardCategory(body.category)

    if (!title) {
      return createErrorResponse({ success: false, error: '제목을 입력해주세요.' }, 400)
    }

    if (!content.trim()) {
      return createErrorResponse({ success: false, error: '내용을 입력해주세요.' }, 400)
    }

    if (!category || category === CATEGORIES.BOARD.ALL) {
      return createErrorResponse({ success: false, error: '게시글 카테고리를 선택해주세요.' }, 400)
    }

    if (!contentFormat) {
      return createErrorResponse({ success: false, error: '본문 형식이 올바르지 않습니다.' }, 400)
    }

    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, author_id, category, is_deleted, is_pinned, pinned_at')
      .eq('id', validPostId)
      .single()

    if (postError || !post) {
      return createErrorResponse({ success: false, error: '게시글을 찾을 수 없습니다.' }, 404)
    }

    if (post.is_deleted) {
      return createErrorResponse({ success: false, error: '삭제된 게시글입니다.' }, 404)
    }

    if (post.author_id !== user.id && !isAdmin) {
      return createErrorResponse({ success: false, error: '게시글을 수정할 권한이 없습니다.' }, 403)
    }

    const shouldPin = category === '공지'
    const { data: updatedPost, error: updateError } = await supabase
      .from('posts')
      .update({
        title,
        content,
        content_format: contentFormat,
        category,
        is_pinned: shouldPin,
        pinned_at: shouldPin ? post.pinned_at || new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', validPostId)
      .select()
      .single()

    if (updateError || !updatedPost) {
      return createErrorResponse({ success: false, error: '게시글 수정에 실패했습니다.' }, 500)
    }

    try {
      revalidatePath('/board')
      revalidatePath('/en/board')
      revalidatePath(`/board/${validPostId}`)
      revalidatePath(`/en/board/${validPostId}`)
      revalidateTag(`post-${validPostId}`)
      revalidateTag('board-post')
      revalidateTag('board-initial')
      revalidateTag(`board-${post.category}`)
      revalidateTag(`board-${category}`)
    } catch {
      // 캐시 무효화 실패는 DB 수정 성공을 실패로 바꾸지 않는다.
    }

    return NextResponse.json({ success: true, post: updatedPost })
  } catch (error) {
    console.error('게시글 수정 API 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}

/**
 * 게시글 삭제 (소프트 삭제)
 * DELETE /api/posts/[id]
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  const postId = resolvedParams.id

  try {
    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      return NextResponse.json(
        { error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.' },
        { status: 400 }
      )
    }

    const validPostId = uuidValidation.sanitized

    const supabase = await createSupabaseServer()

    // 사용자 인증 확인
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return createErrorResponse({ success: false, error: '로그인이 필요합니다.' }, 401)
    }

    // 관리자 여부 확인
    let isAdmin = false
    const { data: prof } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', user.id)
      .single()
    isAdmin = !!(prof?.is_admin && prof.registration_status === 'approved' && prof.is_active)

    // 게시글 조회 및 소유자 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, author_id, category, is_deleted')
      .eq('id', validPostId)
      .single()

    if (postError || !post) {
      return createErrorResponse({ success: false, error: '게시글을 찾을 수 없습니다.' }, 404)
    }

    if (post.is_deleted) {
      return createErrorResponse({ success: false, error: '이미 삭제된 게시글입니다.' }, 404)
    }

    // 작성자 본인 또는 관리자만 삭제 가능
    if (post.author_id !== user.id && !isAdmin) {
      return createErrorResponse({ success: false, error: '게시글을 삭제할 권한이 없습니다.' }, 403)
    }

    // 소프트 삭제 수행
    const { error: updateError } = await supabase
      .from('posts')
      .update({ is_deleted: true })
      .eq('id', validPostId)

    if (updateError) {
      console.error('[API] 게시글 삭제 실패:', updateError)
      return createErrorResponse({ success: false, error: '게시글 삭제에 실패했습니다.' }, 500)
    }

    // 캐시 무효화
    try {
      revalidateTag(`post-${validPostId}`)
      revalidateTag('board-post')
      if (post.category) {
        revalidateTag(`board-${post.category}`)
        revalidateTag('board-initial')
      }
    } catch {
      // 캐시 무효화 실패는 무시
    }

    return NextResponse.json({ message: '게시글이 삭제되었습니다.' })
  } catch (error) {
    console.error('게시글 삭제 API 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}
