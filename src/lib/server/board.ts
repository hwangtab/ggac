import { cache } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { hasTursoEnv } from '@/db/client'
import { listBoardPostsWithStats } from '@/db/queries/posts'
import { createTextPreview } from '@/utils/textUtils'
import { createLogger } from '@/utils/logger'
import { parseIntegerParam } from '@/utils/queryParams'
import { parseBoardCategory } from '@/constants/categories'
import type { Post, PostAttachmentStats } from '@/types'
import type { BoardCategory } from '@/constants/categories'

const log = createLogger('fetchBoardPosts')

export type BoardInitialPost = Post & {
  content_preview: string
  preview_has_images: boolean
  preview_image_count: number
  attachments_stats: NonNullable<Post['attachments_stats']>
  comment_count: number
  like_count: number
}

export interface BoardListParams {
  category?: BoardCategory
  page?: number
  pageSize?: number
}

export interface BoardListResult {
  posts: BoardInitialPost[]
  hasNext: boolean
  hasPrev: boolean
  currentPage: number
  /**
   * true면 TURSO_DATABASE_URL 미설정으로 실제 DB 조회를 건너뛰고 빈 목록을
   * 반환했다는 뜻이다(정상 쿼리가 실패해 빈 배열이 된 경우와 구분하기 위한 필드 —
   * 그 경우는 이 필드가 없다). 정적 프리렌더(board/page.tsx)는 이 빈 결과를 그대로
   * 써도 되지만(noStore()로 캐시되지 않게 막혀 있다), API 라우트
   * (/api/board/posts, /api/posts)는 반드시 이 값을 보고 하드 실패(503)로 되돌려야
   * 한다 — 그러지 않으면 빈 목록이 200으로 CDN에 캐시되어(/api/board/posts는
   * s-maxage=60) 키가 복구된 뒤에도 stale-while-revalidate만큼 더 빈 화면이
   * 서빙된다.
   */
  degraded?: boolean
}

// board_posts_with_stats 뷰(마이그레이션 20260710210000)를 Task 8에서
// `src/db/queries/posts.ts`의 `listBoardPostsWithStats`(Turso/Drizzle)로
// 대체했다 — posts는 단계 3c부터 Turso가 권위이므로, 이 뷰를 계속 Supabase에서
// 읽으면 컷오버 후 새 회원의 글이 "알 수 없음" 저자로 뜬다(Supabase
// member_profiles가 더는 갱신되지 않는다). 응답 모양(BoardInitialPost)과
// 정렬(is_pinned desc, created_at desc, id desc)은 그대로 보존한다. preview는
// content_head(앞 2000자)로 생성 — 이 부분도 원래 뷰와 동일한 절단 방식
// (Postgres left(content,2000) → SQLite substr(content,1,2000)).
export const fetchBoardPosts = cache(
  async ({
    category = '전체',
    page = 1,
    pageSize = 15,
  }: BoardListParams): Promise<BoardListResult> => {
    const safeCategory = parseBoardCategory(category) ?? '전체'
    const safePage = Math.max(1, page)

    // TURSO_DATABASE_URL이 없는 운영 환경(예: 시크릿이 없는 CI 빌드)에서는
    // db/client.ts의 assertProductionCredentials가 실제 쿼리 시점에 throw해
    // 빌드 전체가 죽는다. 운영(Vercel)에는 변수가 항상 있어야 하므로 이
    // 분기는 정상 운영에서는 절대 타지 않아야 한다 — 탄다면 그 자체가 설정
    // 오류이므로 조용히 넘기지 않고 error로 남긴다.
    //
    // 주의(중요): log.error는 반드시 noStore() 호출보다 앞에 둔다. next build의
    // 정적 프리렌더 경로(prerender-legacy)에서 noStore()는 markCurrentScopeAsDynamic을
    // 거쳐 그 자리에서 DynamicServerError를 throw해 렌더를 즉시 중단시키므로, 뒤에
    // 오는 문장(log.error 포함)은 프리렌더 중에는 절대 실행되지 않는다 — 실행 순서를
    // 바꾸면 이 로그가 다시 조용히 사라진다.
    //
    // noStore()로 이 렌더를 동적 렌더링으로 전환해, 키가 없어 얻은 빈 결과가
    // revalidate=60 ISR 스냅샷으로 굳어 운영에 그대로 서빙되는 경로를 원천 차단한다
    // (변수가 있는 정상 경로는 이 분기를 타지 않으므로 ISR이 그대로 유지된다). 단,
    // 두 가지 함정이 있다: ① board/page.tsx에 `export const dynamic = 'force-static'`을
    // 추가하면 unstable-no-store.js의 forceStatic 분기에서 noStore()가 조용히
    // no-op되어 이 가드가 무력화되고 빈 배열이 정적 페이지로 그대로 구워진다 —
    // 절대 추가하지 말 것. ② Next의 cacheComponents/dynamicIO(Next 16 방향)로
    // 전환하면 unstable_noStore()가 no-op이 되므로, 그때는 connection()
    // (next/server)으로 바꿔야 같은 보장이 유지된다.
    //
    // API 라우트(/api/board/posts, /api/posts)는 이 분기의 반환값(degraded: true)을
    // 반드시 확인해 하드 실패(503)로 되돌려야 한다 — noStore()는 페이지 프리렌더만
    // 보호하며, API Route Handler는 이미 동적이라 noStore()가 아무 효과가 없다.
    if (!hasTursoEnv()) {
      log.error(
        'TURSO_DATABASE_URL이 설정되지 않아 게시판 조회를 건너뜁니다. 운영 환경이라면 환경변수 설정을 확인하세요.'
      )
      noStore()
      return {
        posts: [],
        hasNext: false,
        hasPrev: safePage > 1,
        currentPage: safePage,
        degraded: true,
      }
    }

    // 목록 정적화(Phase 1) 후 서버는 전량을 한 번에 렌더하므로 상한을 넉넉히 둔다
    const limit = Math.max(1, Math.min(pageSize, 200))
    const offset = (safePage - 1) * limit

    let statsResult
    try {
      statsResult = await listBoardPostsWithStats({ category: safeCategory, offset, limit })
    } catch (error) {
      log.error('Failed to load posts:', error instanceof Error ? error.message : error)
      return { posts: [], hasNext: false, hasPrev: safePage > 1, currentPage: safePage }
    }

    const { rows, hasNext } = statsResult

    const posts: BoardInitialPost[] = rows.map(row => {
      const preview = createTextPreview(row.content_head || '', 150, row.content_format)
      const imageCount = parseIntegerParam(String(row.image_count ?? ''), 0, { min: 0 })

      return {
        id: row.id,
        title: row.title,
        content: '',
        category: row.category,
        author_id: row.author_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_pinned: row.is_pinned,
        author: row.author_display_name
          ? {
              name: '',
              email: '',
              display_name: row.author_display_name,
            }
          : undefined,
        content_preview: preview.text,
        preview_has_images: imageCount > 0 || preview.hasImages,
        preview_image_count: imageCount > 0 ? imageCount : preview.imageCount,
        comment_count: parseIntegerParam(String(row.comment_count ?? ''), 0, { min: 0 }),
        like_count: parseIntegerParam(String(row.like_count ?? ''), 0, { min: 0 }),
        attachments_stats: {
          total_attachments: parseIntegerParam(String(row.total_attachments ?? ''), 0, { min: 0 }),
          total_size: parseIntegerParam(String(row.total_size ?? ''), 0, { min: 0 }),
          image_count: imageCount,
          document_count: parseIntegerParam(String(row.document_count ?? ''), 0, { min: 0 }),
          video_count: parseIntegerParam(String(row.video_count ?? ''), 0, { min: 0 }),
          audio_count: parseIntegerParam(String(row.audio_count ?? ''), 0, { min: 0 }),
        } satisfies PostAttachmentStats,
      }
    })

    return {
      posts,
      hasNext,
      hasPrev: safePage > 1,
      currentPage: safePage,
    }
  }
)
