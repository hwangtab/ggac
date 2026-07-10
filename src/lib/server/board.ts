import { cache } from 'react'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
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
    const supabase = getSupabaseServerClient()
    const safeCategory = parseBoardCategory(category) ?? '전체'
    const safePage = Math.max(1, page)
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
