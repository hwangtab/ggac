import { cache } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { createServiceRoleClient, hasServiceRoleEnv } from '@/lib/server/supabaseAdmin'
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
   * true면 SUPABASE_SERVICE_ROLE_KEY 미설정으로 실제 DB 조회를 건너뛰고 빈 목록을
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

const getSupabaseServerClient = () => {
  return createServiceRoleClient()
}

// board_posts_with_stats 뷰(마이그레이션 20260710210000) 1쿼리로 목록을 만든다.
// 과거에는 posts 전본문 + 첨부/댓글/좋아요 전행(4쿼리)을 가져와 JS에서 집계했는데,
// 이것이 post_likes seq scan 18.6만 회와 게시글당 수십 KB 본문 전송의 원인이었다
// (2026-07 전수감사 API High 2·3). preview는 뷰의 content_head(앞 2000자)로 생성.
export const fetchBoardPosts = cache(
  async ({
    category = '전체',
    page = 1,
    pageSize = 15,
  }: BoardListParams): Promise<BoardListResult> => {
    const safeCategory = parseBoardCategory(category) ?? '전체'
    const safePage = Math.max(1, page)

    // SUPABASE_SERVICE_ROLE_KEY가 없는 환경(예: 전권 키를 두지 않는 public 저장소의
    // CI 빌드)에서는 이 함수가 무조건 service role 클라이언트를 요구하므로 프리렌더
    // 시점에 throw해 빌드 전체가 죽는다. 운영(Vercel)에는 키가 항상 있어야 하므로
    // 이 분기는 정상 운영에서는 절대 타지 않아야 한다 — 탄다면 그 자체가 설정
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
    // (키가 있는 정상 경로는 이 분기를 타지 않으므로 ISR이 그대로 유지된다). 단,
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
    if (!hasServiceRoleEnv()) {
      log.error(
        'SUPABASE_SERVICE_ROLE_KEY(또는 NEXT_PUBLIC_SUPABASE_URL)가 설정되지 않아 게시판 조회를 건너뜁니다. 운영 환경이라면 환경변수 설정을 확인하세요.'
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

    const supabase = getSupabaseServerClient()
    // 목록 정적화(Phase 1) 후 서버는 전량을 한 번에 렌더하므로 상한을 넉넉히 둔다
    const limit = Math.max(1, Math.min(pageSize, 200))
    const start = (safePage - 1) * limit
    const end = start + limit

    let query = supabase
      .from('board_posts_with_stats')
      .select(
        'id, title, category, author_id, created_at, updated_at, is_pinned, content_head, like_count, author_display_name, comment_count, total_attachments, total_size, image_count, document_count, video_count, audio_count'
      )

    if (safeCategory !== '전체') {
      query = query.eq('category', safeCategory)
    }

    query = query
      .order('is_pinned', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, end)

    const { data, error } = await query

    if (error) {
      log.error('Failed to load posts:', error.message)
      return { posts: [], hasNext: false, hasPrev: safePage > 1, currentPage: safePage }
    }

    const rows = data || []
    const hasNext = rows.length > limit

    if (hasNext) {
      rows.pop()
    }

    const posts: BoardInitialPost[] = rows.map(row => {
      const preview = createTextPreview(row.content_head || '', 150)
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
