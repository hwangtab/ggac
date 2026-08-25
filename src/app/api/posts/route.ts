/**
 * 게시글 목록 조회 API - 단순 페이지 기반
 *
 * Turso 전환 메모(Task 4·갱신 Task 8): 이 파일의 GET은 `posts`/
 * `member_profiles`를 직접 조회하지 않는다 — `fetchBoardPosts`
 * (`@/lib/server/board`)에 위임한다. Task 8에서 그 함수 안의
 * `board_posts_with_stats` 뷰 읽기 자체가 `listBoardPostsWithStats`(Turso
 * 쿼리 계층, `src/db/queries/posts.ts`)로 대체됐다 — 이 파일은 여전히
 * `fetchBoardPosts`에 위임만 하고 직접 손대지 않지만, 이제 그 위임 경로
 * 전체가 Turso다(Supabase 뷰는 더 이상 존재하지 않는다).
 *
 * 단계 2c 후속(Task 6 코드리뷰 대응): "사용자가 좋아요한 게시글" 표시
 * (`userLikedSet`)만은 별개 조회였다 — 컷오버 후 새로 누른 좋아요가
 * 목록에서 하트로 안 보이는 버그(Turso에는 기록되는데 이 조회가 얼어붙은
 * Supabase 스냅샷을 봤다)로 실제로 드러나, `getLikedPostIds`(Turso 쿼리
 * 계층, `src/db/queries/likes.ts`)로 옮겼다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getLikedPostIds } from '@/db/queries/likes'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/lib/server/rateLimit'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember, getOptionalUser } from '@/lib/server/memberAuth'
import { fetchBoardPosts } from '@/lib/server/board'
import { parseIntegerParam } from '@/utils/queryParams'
import { CATEGORIES, parseBoardCategory } from '@/constants/categories'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { annotateImageDimensionsSafe } from '@/utils/imageDimensions'
import { getBoardListRevalidationPaths } from '@/lib/revalidationPaths'
import { createPost } from '@/db/queries/posts'
import { notifyNewPost } from '@/lib/server/postNotify'

export const runtime = 'nodejs'
export const revalidate = 60

interface PostData {
  id: string
  title: string
  content: string
  category: string
  author_id: string
  created_at: string
  updated_at: string
  is_pinned: boolean
  comment_count: number
  like_count?: number
  is_liked?: boolean
  author: {
    display_name: string
    email: string
  }
  attachments_stats?: any
  content_preview?: string
  preview_has_images?: boolean
  preview_image_count?: number
}

interface PostListResponse {
  posts: PostData[]
  pagination: {
    limit: number
    has_next: boolean
    has_prev: boolean
    next_cursor: string | null
    prev_cursor: string | null
  }
  filters: {
    category: string | null
    search: string | null
    sort_by: string
    sort_order: string
  }
}

export async function GET(request: NextRequest) {
  // 로그인 여부에 따라 개인화 데이터(내 좋아요 여부)를 얹는 선택적 조회다.
  // 비로그인도 게시글 목록을 읽을 수 있어야 하므로 requireUser로 바꾸지 않는다.
  const user = await getOptionalUser()
  const userId = user?.id || null

  return apiGet(
    async () => {
      const rateLimiter = await applyRateLimit({
        ...RATE_LIMIT_CONFIGS.GENERAL_API,
        keyGenerator: createUserKeyGenerator('posts'),
      })
      const rateLimitResult = await rateLimiter(request)
      if (!rateLimitResult.success) {
        throw ApiError.tooManyRequests('너무 많은 요청입니다. 잠시 후 다시 시도해주세요.')
      }

      const { searchParams } = new URL(request.url)
      const categoryParam = searchParams.get('category') || '전체'
      const boardCategory = parseBoardCategory(categoryParam)
      const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: 50 })
      const direction = searchParams.get('direction') || 'next'
      const pageParam = searchParams.get('page')
      const cursorParam = searchParams.get('cursor')

      let page = parseIntegerParam(pageParam ?? cursorParam, 1, { min: 1 })
      if (direction === 'prev') {
        page = Math.max(1, page - 1)
      }

      if (!boardCategory) {
        throw ApiError.badRequest('유효하지 않은 카테고리입니다.')
      }

      const boardResult = await fetchBoardPosts({ category: boardCategory, page, pageSize: limit })

      // degraded === true는 쿼리 실패가 아니라 SUPABASE_SERVICE_ROLE_KEY가 없어
      // fetchBoardPosts가 DB 조회 자체를 건너뛴 경우다(src/lib/server/board.ts 참고).
      // 이 라우트는 기본이 private, no-store라 캐시 문제는 없지만, 200 빈 목록을
      // 그대로 내려주면 클라이언트가 "정말로 글이 없다"고 오해한다 — 하드 실패로
      // 되돌려 원인을 드러낸다. apiGet(withApiWrapper)이 ApiError를 그대로
      // status/message 보존해 응답한다.
      if (boardResult.degraded) {
        throw ApiError.serviceUnavailable('게시판 서비스를 일시적으로 사용할 수 없습니다.')
      }

      const postIds = boardResult.posts.map(post => post.id)

      // 단계 2c 후속(Task 6 코드리뷰 대응): post_likes 조회를 Supabase에서
      // Turso 쿼리 계층(getLikedPostIds, 배치 inArray)으로 옮겼다 — 게시글마다
      // 쿼리하지 않는다. postIds가 비면 getLikedPostIds가 쿼리 없이 즉시 빈
      // Set을 돌려준다.
      //
      // 리뷰 대응(2차): getLikedPostIds는 이 저장소의 다른 쿼리 계층 함수처럼
      // 실패 시 throw한다 — 옛 Supabase 클라이언트는 조회 실패를 `{data,
      // error}`로 삼켜서 "목록은 뜨고 하트만 안 채워진다"였는데, throw를
      // 그대로 두면 apiGet 래퍼가 이 예외를 500으로 바꿔 게시판 목록
      // 전체가 사라진다(로그인 사용자만 — 비로그인은 이 조회 자체를 안
      // 탄다). 같은 diff의 나머지 6개 파일이 전부 `.catch()`로 이 흡수
      // 성질을 보존했는데 여기만 빠뜨렸었다 — `.catch()`로 감싸 빈
      // Set으로 흡수한다(하트만 안 채워지는 게 목록이 통째로 사라지는
      // 것보다 낫다).
      const userLikedSet = userId
        ? await getLikedPostIds(userId, postIds).catch(error => {
            console.error('[API] 게시판 목록 좋아요 조회 실패 — 하트 없이 계속 진행:', error)
            return new Set<string>()
          })
        : new Set<string>()

      const posts: PostData[] = boardResult.posts.map(post => ({
        id: post.id,
        title: post.title,
        content: '',
        category: post.category,
        author_id: post.author_id,
        created_at: post.created_at,
        updated_at: post.updated_at,
        is_pinned: post.is_pinned,
        comment_count: post.comment_count,
        like_count: post.like_count,
        is_liked: userLikedSet.has(post.id),
        author: {
          display_name: post.author?.display_name || '알 수 없음',
          email: '',
        },
        attachments_stats: post.attachments_stats,
        content_preview: post.content_preview,
        preview_has_images: post.preview_has_images,
        preview_image_count: post.preview_image_count,
      }))

      const result: PostListResponse = {
        posts,
        pagination: {
          limit,
          has_next: boardResult.hasNext,
          has_prev: boardResult.hasPrev,
          next_cursor: boardResult.hasNext ? String(boardResult.currentPage + 1) : null,
          prev_cursor: boardResult.hasPrev
            ? String(Math.max(1, boardResult.currentPage - 1))
            : null,
        },
        filters: {
          category: boardCategory === '전체' ? null : boardCategory,
          search: null,
          sort_by: 'created_at',
          sort_order: 'desc',
        },
      }

      return ApiSuccess.ok(result, '게시글 목록을 불러왔습니다.')
    },
    '/api/posts',
    { userId: userId || undefined }
  )
}

export async function POST(request: NextRequest) {
  // 레이트리밋은 원래도 인증 확인보다 먼저 검사했다 — 순서를 그대로 유지한다.
  const rateLimiter = await applyRateLimit({
    ...RATE_LIMIT_CONFIGS.GENERAL_API,
    keyGenerator: createUserKeyGenerator('posts:create'),
  })
  const rateLimitResult = await rateLimiter(request)
  if (!rateLimitResult.success) {
    return ApiError.tooManyRequests(
      '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.'
    ).toNextResponse()
  }

  // 게시글 작성은 로그인 + 승인된 활성 멤버만 가능한 강제 검사였다.
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) {
        throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
      }

      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const content = typeof body.content === 'string' ? body.content : ''
      const category = parseBoardCategory(body.category)

      if (!title) {
        throw ApiError.badRequest('제목을 입력해주세요.')
      }

      if (!content.trim()) {
        throw ApiError.badRequest('내용을 입력해주세요.')
      }

      if (!category || category === CATEGORIES.BOARD.ALL) {
        throw ApiError.badRequest('게시글 카테고리를 선택해주세요.')
      }

      const isPinned = category === '공지'
      // content_format은 항상 'html' → 저장 전 본문 이미지 크기 주입(CLS 방지). 절대 throw 안 함.
      const contentToSave = await annotateImageDimensionsSafe(content)
      // 단계 2c(Task 5): posts INSERT를 Supabase에서 Turso 쿼리 계층
      // createPost(Turso)로 옮겼다. 응답 스키마는 동일 — 기존 Supabase
      // `.insert(...).select().single()`도 author 임베드 없이 posts 컬럼만
      // 돌려줬고(호출부 usePostCreation.ts는 post.id만 읽는다), createPost도
      // 마찬가지다. 삽입 실패 시 기존과 같은 400(badRequest)으로 응답한다.
      let post
      try {
        post = await createPost({
          title,
          content: contentToSave,
          content_format: 'html',
          category,
          author_id: user.id,
          is_pinned: isPinned,
          pinned_at: isPinned ? new Date().toISOString() : null,
        })
      } catch (insertError) {
        throw ApiError.badRequest(
          insertError instanceof Error ? insertError.message : '게시글 작성에 실패했습니다.'
        )
      }

      try {
        // ko는 URL에 접두사가 없지만 렌더는 내부 rewrite된 `/ko/board`에서
        // 일어나므로 `/board`로는 무효화되지 않는다. 자세한 배경은
        // @/lib/revalidationPaths 참고.
        for (const boardPath of getBoardListRevalidationPaths()) {
          revalidatePath(boardPath)
        }
        revalidateTag('board-post')
        revalidateTag('board-initial')
        revalidateTag(`board-${category}`)
      } catch {
        // Cache invalidation must not turn a successful database write into a failed create.
      }

      // 공지(category === '공지')인 경우에만 승인 회원 전체에게 알림을
      // 배치 발송한다. 실패는 로깅만 하고 게시글 작성 응답을 막지 않는다
      // (notifyNewPost 내부에서 이미 흡수한다).
      await notifyNewPost({
        postId: post.id,
        authorId: post.author_id,
        title: post.title,
        category: post.category,
      })

      return ApiSuccess.created(post, '게시글이 작성되었습니다.')
    },
    '/api/posts',
    { userId: user.id }
  )
}
