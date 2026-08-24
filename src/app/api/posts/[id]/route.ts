/**
 * 개별 게시글 조회 API
 * 좋아요 정보를 포함한 게시글 상세 정보 제공
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
import { RATE_LIMITS, applyRateLimit, createUserKeyGenerator } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { parseIntegerParam } from '@/utils/queryParams'
import { revalidatePath, revalidateTag } from 'next/cache'
import { CATEGORIES, parseBoardCategory } from '@/constants/categories'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { annotateImageDimensionsSafe } from '@/utils/imageDimensions'
import { getBoardPostRevalidationPaths } from '@/lib/revalidationPaths'
import { requireUser, requireActiveMember, getOptionalUser } from '@/lib/server/memberAuth'
import { getPostById } from '@/db/queries/posts'
import { getProfileById } from '@/db/queries/profiles'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  const postId = resolvedParams.id

  try {
    const timings: Record<string, number> = {}
    const t0 = Date.now()
    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }

    // 분산 Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMITS.GENERAL_API,
      keyGenerator: createUserKeyGenerator('post_detail'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const supabase = await createSupabaseServer()
    // 로그인 여부에 따라 개인화 데이터(내 좋아요·삭제글 접근 등)를 얹는
    // 선택적 조회다. 비로그인도 게시글 상세를 읽을 수 있어야 하므로
    // requireUser로 바꾸지 않는다.
    // 세션은 선택 사항(공개 열람 허용), 사용자 ID가 있으면 is_liked 등 계산에 사용
    const user = await getOptionalUser()
    const userId = user?.id || null
    let isAdmin = false
    if (userId) {
      // member_profiles는 이제 Turso가 권위다. 조회 실패는 이전 `.single()`
      // 실패와 같은 최종 결과(관리자 아님, fail-closed)로 흡수한다.
      const prof = await getProfileById(userId).catch(() => null)
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
    // 읽기 전용 DB 클라이언트 선택
    // - 로그인 사용자: 세션 클라이언트 (사용자별 데이터 접근)
    // - 비로그인 사용자: service role (공개 데이터만 읽기) — 필요할 때만 생성
    const db = userId
      ? supabase
      : (() => {
          try {
            return createServiceRoleClient()
          } catch {
            return supabase
          }
        })()
    const { searchParams } = new URL(request.url)
    const includeComments = searchParams.get('include_comments') !== 'false' // 기본적으로 포함
    const includeAttachments = searchParams.get('include_attachments') !== 'false' // 기본적으로 포함
    const includeContent = searchParams.get('include_content') !== 'false' // 기본 포함, false면 본문 지연 로딩
    const commentsLimit = parseIntegerParam(searchParams.get('limit'), 30, { min: 1, max: 100 })
    const commentsOffset = parseIntegerParam(searchParams.get('offset'), 0, { min: 0 })

    // 게시글 기본 정보 조회. is_deleted 필터 없이(includeDeleted: true) 가져와
    // 아래에서 직접 삭제글 접근 권한을 판정한다 — 기존 PostgREST 쿼리도
    // is_deleted 조건 없이 조회한 뒤 애플리케이션에서 분기했다.
    const postStart = Date.now()
    let post: {
      id: string
      title: string
      content: string
      content_format: string
      category: string
      author_id: string
      created_at: string
      updated_at: string
      is_deleted: boolean
      is_pinned: boolean
      like_count: number
      author: { display_name: string; email: string }
    } | null = null
    try {
      const fullPost = await getPostById(validPostId, { includeDeleted: true })
      if (fullPost) {
        post = {
          id: fullPost.id,
          title: fullPost.title,
          content: fullPost.content,
          content_format: fullPost.content_format,
          category: fullPost.category,
          author_id: fullPost.author_id,
          created_at: fullPost.created_at,
          updated_at: fullPost.updated_at,
          is_deleted: fullPost.is_deleted,
          is_pinned: fullPost.is_pinned,
          like_count: fullPost.like_count,
          author: { display_name: fullPost.author.display_name, email: fullPost.author.email },
        }
      }
    } catch (postFetchError) {
      console.error(`[API] 게시글 조회 실패 - ID: ${validPostId}`, postFetchError)
    }

    timings.post_ms = Date.now() - postStart
    if (!post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    // 삭제된 게시글 접근 권한 확인
    if (post.is_deleted && !(isAdmin || (userId && post.author_id === userId))) {
      return ApiError.notFound('삭제된 게시글입니다.').toNextResponse()
    }

    // 게시글 확인 후의 조회 4개(내 좋아요·댓글 수·댓글 목록·첨부)는 상호 독립이므로
    // 병렬 실행한다 — 기존에는 전부 순차라 왕복 지연이 단계 수만큼 누적됐다
    // (전수감사 API High 1). 사용자별 댓글 좋아요만 댓글 목록에 의존해 후행.
    const parallelStart = Date.now()
    const [userLikeResult, commentCountResult, commentsResult, attachmentsResult] =
      await Promise.all([
        userId
          ? supabase
              .from('post_likes')
              .select('id')
              .eq('post_id', validPostId)
              .eq('user_id', userId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        db.from('comments').select('id', { count: 'exact', head: true }).eq('post_id', validPostId),
        includeComments
          ? db
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
          : Promise.resolve({ data: null, error: null }),
        includeAttachments
          ? db
              .from('post_attachments')
              .select('*')
              .eq('post_id', validPostId)
              .order('sort_order', { ascending: true })
          : Promise.resolve({ data: null, error: null }),
      ])
    timings.parallel_reads_ms = Date.now() - parallelStart

    const isLiked = !!userLikeResult.data
    const commentCount = commentCountResult.count ?? 0

    let comments: any[] = []
    if (includeComments) {
      if (commentsResult.error) {
        console.error('댓글 조회 오류:', commentsResult.error)
      } else {
        comments = commentsResult.data || []
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

    let attachments: any[] = []
    if (includeAttachments) {
      if (attachmentsResult.error) {
        console.error('첨부파일 조회 오류:', attachmentsResult.error)
      } else {
        attachments = attachmentsResult.data || []
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
    return ApiSuccess.ok({ post: responseData }).toNextResponse()
  } catch (error) {
    console.error('게시글 상세 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
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
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }

    const validPostId = uuidValidation.sanitized

    const rateLimiter = await applyRateLimit({
      ...RATE_LIMITS.GENERAL_API,
      keyGenerator: createUserKeyGenerator('post_update'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const supabase = await createSupabaseServer()

    // 게시글 수정은 로그인 + 승인된 활성 멤버만 가능한 강제 검사였다.
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user, profile } = auth

    const isAdmin = profile?.is_admin === true

    const body = await parseJsonObjectBody(request)
    if (!body) {
      return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
    }

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const content = typeof body.content === 'string' ? body.content : ''
    const contentFormat =
      body.content_format === 'plain' || body.content_format === 'html' ? body.content_format : null
    const category = parseBoardCategory(body.category)

    if (!title) {
      return ApiError.badRequest('제목을 입력해주세요.').toNextResponse()
    }

    if (!content.trim()) {
      return ApiError.badRequest('내용을 입력해주세요.').toNextResponse()
    }

    if (!category || category === CATEGORIES.BOARD.ALL) {
      return ApiError.badRequest('게시글 카테고리를 선택해주세요.').toNextResponse()
    }

    if (!contentFormat) {
      return ApiError.badRequest('본문 형식이 올바르지 않습니다.').toNextResponse()
    }

    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, author_id, category, is_deleted, is_pinned, pinned_at')
      .eq('id', validPostId)
      .single()

    if (postError || !post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    if (post.is_deleted) {
      return ApiError.notFound('삭제된 게시글입니다.').toNextResponse()
    }

    if (post.author_id !== user.id && !isAdmin) {
      return ApiError.forbidden('게시글을 수정할 권한이 없습니다.').toNextResponse()
    }

    const shouldPin = category === '공지'
    // html 본문일 때만 저장 전 이미지 크기 주입(CLS 방지). Safe 래퍼는 절대 throw 안 함.
    const contentToSave =
      contentFormat === 'html' ? await annotateImageDimensionsSafe(content) : content
    const { data: updatedPost, error: updateError } = await supabase
      .from('posts')
      .update({
        title,
        content: contentToSave,
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
      return ApiError.internalServerError('게시글 수정에 실패했습니다.').toNextResponse()
    }

    try {
      // ko는 URL에 접두사가 없지만 렌더는 내부 rewrite된 `/ko/board...`에서
      // 일어나므로 `/board`로는 무효화되지 않는다. 자세한 배경은
      // @/lib/revalidationPaths 참고.
      for (const boardPath of getBoardPostRevalidationPaths(validPostId)) {
        revalidatePath(boardPath)
      }
      revalidateTag(`post-${validPostId}`)
      revalidateTag('board-post')
      revalidateTag('board-initial')
      revalidateTag(`board-${post.category}`)
      revalidateTag(`board-${category}`)
    } catch {
      // 캐시 무효화 실패는 DB 수정 성공을 실패로 바꾸지 않는다.
    }

    return ApiSuccess.ok({ post: updatedPost }).toNextResponse()
  } catch (error) {
    console.error('게시글 수정 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
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
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }

    const validPostId = uuidValidation.sanitized

    const supabase = await createSupabaseServer()

    // 게시글 삭제는 로그인만 확인한다(승인 여부는 보지 않음). 소유자/관리자
    // 판정은 아래에서 별도로 한다.
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

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
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    if (post.is_deleted) {
      return ApiError.notFound('이미 삭제된 게시글입니다.').toNextResponse()
    }

    // 작성자 본인 또는 관리자만 삭제 가능
    if (post.author_id !== user.id && !isAdmin) {
      return ApiError.forbidden('게시글을 삭제할 권한이 없습니다.').toNextResponse()
    }

    // 소프트 삭제 수행
    const { error: updateError } = await supabase
      .from('posts')
      .update({ is_deleted: true })
      .eq('id', validPostId)

    if (updateError) {
      console.error('[API] 게시글 삭제 실패:', updateError)
      return ApiError.internalServerError('게시글 삭제에 실패했습니다.').toNextResponse()
    }

    // 캐시 무효화
    try {
      // 삭제는 원래 태그 무효화만 했는데, 이 저장소에서 `board-*`/`post-*` 태그를
      // 부착하는 fetch가 하나도 없어서(유일한 태그는 data.ts의 'artists') 사실상
      // 아무것도 무효화하지 않았다. 목록·상세 경로를 직접 무효화해 삭제된 글이
      // 캐시에 남지 않게 한다. 로케일 접두사 처리는 @/lib/revalidationPaths 참고.
      for (const boardPath of getBoardPostRevalidationPaths(validPostId)) {
        revalidatePath(boardPath)
      }
      revalidateTag(`post-${validPostId}`)
      revalidateTag('board-post')
      if (post.category) {
        revalidateTag(`board-${post.category}`)
        revalidateTag('board-initial')
      }
    } catch {
      // 캐시 무효화 실패는 무시
    }

    return ApiSuccess.ok({ message: '게시글이 삭제되었습니다.' }).toNextResponse()
  } catch (error) {
    console.error('게시글 삭제 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
