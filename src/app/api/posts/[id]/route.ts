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
import { RATE_LIMITS, applyRateLimit, createUserKeyGenerator } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { parseIntegerParam } from '@/utils/queryParams'
import { revalidatePath } from 'next/cache'
import { CATEGORIES, parseBoardCategory } from '@/constants/categories'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { annotateImageDimensionsSafe } from '@/utils/imageDimensions'
import { getBoardPostRevalidationPaths } from '@/lib/revalidationPaths'
import { requireUser, requireActiveMember, getOptionalUser } from '@/lib/server/memberAuth'
import { getPostById, updatePost, softDeletePost } from '@/db/queries/posts'
import { getProfileById } from '@/db/queries/profiles'
import { countComments, listCommentsByOffset } from '@/db/queries/comments'
import { getLikedCommentIds, isPostLikedByUser } from '@/db/queries/likes'
import { listAttachments } from '@/db/queries/attachments'
import { parsePostContentFormat } from '@/utils/postContentFormat'

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

    // 단계 2c 후속(Task 6 확장): comments/post_likes/comment_likes/
    // post_attachments가 전부 Turso로 옮겨가면서, 익명 사용자를 위해 RLS를
    // 우회하던 Service Role 클라이언트가 더 이상 필요 없다 — Turso 쿼리
    // 계층에는 RLS 자체가 없다(권한 판정은 이 라우트가 위에서 이미 했다).
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
      // email은 없다 — 비로그인도 열람 가능한 응답이라, 목록 API
      // (src/app/api/posts/route.ts)와 마찬가지로 조합원 이메일을 실어 보내지
      // 않는다. 이 라우트 안에서 email을 다른 용도로 쓰는 코드는 없다(grep 확인).
      author: { display_name: string }
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
          // 응답에 email을 담지 않는다(비로그인도 조회 가능한 엔드포인트라
          // 게시글 id만 알면 조합원 이메일을 수집할 수 있었다).
          author: { display_name: fullPost.author.display_name },
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
    //
    // 단계 2c 후속(Task 6 확장): 4개 전부 Supabase에서 Turso 쿼리 계층으로
    // 옮겼다(isPostLikedByUser/countComments/listCommentsByOffset/
    // listAttachments). 옛 Supabase 클라이언트는 쿼리가 실패해도 throw하지
    // 않고 `{data, error}`로 반환해 "한 필드 조회가 실패해도 게시글 자체는
    // 계속 뜬다"는 성질이 있었다 — Turso 쿼리 계층 함수는 실패 시 throw하므로
    // (이 저장소의 일관된 원칙), 그 성질을 유지하려면 각 호출을 개별
    // `.catch()`로 감싸 안전한 기본값(false/0/빈 배열)으로 흡수해야 한다.
    // 게시글 조회(위 postStart 블록)만 여전히 그 자체의 try/catch로 진짜
    // 실패를 구분한다 — 나머지 4개는 부가 정보라 실패해도 상세 페이지
    // 전체를 죽이면 안 된다.
    const parallelStart = Date.now()
    const [isLiked, commentCount, rawComments, attachments] = await Promise.all([
      userId
        ? isPostLikedByUser(validPostId, userId).catch(error => {
            console.error('좋아요 조회 오류:', error)
            return false
          })
        : Promise.resolve(false),
      countComments(validPostId).catch(error => {
        console.error('댓글 수 조회 오류:', error)
        return 0
      }),
      includeComments
        ? listCommentsByOffset(validPostId, {
            limit: commentsLimit,
            offset: commentsOffset,
          }).catch(error => {
            console.error('댓글 조회 오류:', error)
            return [] as Awaited<ReturnType<typeof listCommentsByOffset>>
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof listCommentsByOffset>>),
      includeAttachments
        ? listAttachments(validPostId).catch(error => {
            console.error('첨부파일 조회 오류:', error)
            return [] as Awaited<ReturnType<typeof listAttachments>>
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof listAttachments>>),
    ])
    timings.parallel_reads_ms = Date.now() - parallelStart

    let comments: any[] = []
    if (includeComments) {
      // 사용자별 좋아요만 확인(카운트는 comments.like_count 사용)
      const ids = rawComments.map(c => c.id)
      let userLikedSet: Set<string> | null = null
      if (userId && ids.length > 0) {
        const userLikesStart = Date.now()
        userLikedSet = await getLikedCommentIds(userId, ids).catch(error => {
          console.error('댓글 좋아요 조회 오류:', error)
          return new Set<string>()
        })
        timings.comment_likes_user_ms = Date.now() - userLikesStart
      }
      comments = rawComments.map(c => ({
        id: c.id,
        content: c.content,
        author_id: c.author_id,
        created_at: c.created_at,
        like_count: c.like_count ?? 0,
        author: c.author,
        is_liked: userLikedSet ? userLikedSet.has(c.id) : false,
      }))
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
    const contentFormat = parsePostContentFormat(body.content_format)
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

    // 단계 2c(Task 5): posts 조회를 Supabase `.eq('id', validPostId)`에서 Turso
    // 쿼리 계층 getPostById(validPostId, { includeDeleted: true })로 옮겼다 —
    // is_deleted 필터 없이 조회한 뒤 애플리케이션에서 분기하던 기존 동작(GET
    // 핸들러가 이미 Task 4에서 옮긴 것과 같은 패턴)을 그대로 재현한다.
    const post = await getPostById(validPostId, { includeDeleted: true })

    if (!post) {
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
    // updated_at은 더 이상 여기서 직접 계산하지 않는다 — Postgres
    // update_posts_updated_at 트리거가 SQLite에는 없어서, posts 스키마의
    // $onUpdate 훅(src/db/schema/_shared.ts)이 updatePost의 .set() 호출마다
    // 자동으로 현재 시각을 채운다(트리거 재현, Task 3 member_profiles와 동일
    // 메커니즘).
    let updatedPost
    try {
      updatedPost = await updatePost(validPostId, {
        title,
        content: contentToSave,
        content_format: contentFormat,
        category,
        is_pinned: shouldPin,
        pinned_at: shouldPin ? post.pinned_at || new Date().toISOString() : null,
      })
    } catch (updateError) {
      console.error('[API] 게시글 수정 실패:', updateError)
      updatedPost = null
    }

    if (!updatedPost) {
      return ApiError.internalServerError('게시글 수정에 실패했습니다.').toNextResponse()
    }

    try {
      // ko는 URL에 접두사가 없지만 렌더는 내부 rewrite된 `/ko/board...`에서
      // 일어나므로 `/board`로는 무효화되지 않는다. 자세한 배경은
      // @/lib/revalidationPaths 참고.
      for (const boardPath of getBoardPostRevalidationPaths(validPostId)) {
        revalidatePath(boardPath)
      }
      // 태그 무효화는 하지 않는다 — 부착하는 곳이 없어 아무 일도 하지 않는다.
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

    // 게시글 삭제는 로그인만 확인한다(승인 여부는 보지 않음). 소유자/관리자
    // 판정은 아래에서 별도로 한다.
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 관리자 여부 확인. 단계 2c(Task 5): member_profiles 조회를 Supabase
    // `.eq('id', user.id)`에서 Turso 쿼리 계층 getProfileById(user.id)로
    // 옮겼다 — 조건식(is_admin && registration_status==='approved' &&
    // is_active) 자체는 문자 그대로 보존.
    let isAdmin = false
    const prof = await getProfileById(user.id).catch(() => null)
    isAdmin = !!(prof?.is_admin && prof.registration_status === 'approved' && prof.is_active)

    // 게시글 조회 및 소유자 확인. 단계 2c(Task 5): posts 조회를 Supabase
    // `.eq('id', validPostId)`에서 Turso 쿼리 계층 getPostById(validPostId,
    // { includeDeleted: true })로 옮겼다 — is_deleted 필터 없이 조회한 뒤
    // 아래에서 직접 분기하는 기존 동작을 그대로 재현한다.
    const post = await getPostById(validPostId, { includeDeleted: true })

    if (!post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    if (post.is_deleted) {
      return ApiError.notFound('이미 삭제된 게시글입니다.').toNextResponse()
    }

    // 작성자 본인 또는 관리자만 삭제 가능
    if (post.author_id !== user.id && !isAdmin) {
      return ApiError.forbidden('게시글을 삭제할 권한이 없습니다.').toNextResponse()
    }

    // 소프트 삭제 수행. 단계 2c(Task 5): Supabase
    // `.update({ is_deleted: true }).eq('id', validPostId)`에서 Turso 쿼리
    // 계층 softDeletePost(validPostId)로 옮겼다 — 여전히 소프트 삭제다(하드
    // 삭제로 바뀌지 않았다).
    try {
      await softDeletePost(validPostId)
    } catch (updateError) {
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
    } catch {
      // 캐시 무효화 실패는 무시
    }

    return ApiSuccess.ok({ message: '게시글이 삭제되었습니다.' }).toNextResponse()
  } catch (error) {
    console.error('게시글 삭제 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
