import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { createTextPreview } from '@/utils/textUtils'
import type { Post, PostAttachmentStats } from '@/types'

export type BoardInitialPost = Post & {
  content_preview: string
  preview_has_images: boolean
  preview_image_count: number
  attachments_stats: NonNullable<Post['attachments_stats']>
  comment_count: number
  like_count: number
}

export interface BoardListParams {
  category?: string
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || (!serviceKey && !anonKey)) {
    throw new Error('Supabase credentials are not configured for server-side board fetch.')
  }

  return createClient(url, serviceKey || anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export const fetchBoardPosts = cache(
  async ({
    category = '전체',
    page = 1,
    pageSize = 15,
  }: BoardListParams): Promise<BoardListResult> => {
    const supabase = getSupabaseServerClient()
    const safePage = Math.max(1, page)
    const limit = Math.max(1, Math.min(pageSize, 50))
    const start = (safePage - 1) * limit
    const end = start + limit

    let query = supabase
      .from('posts')
      .select(
        `
        id,
        title,
        content,
        category,
        author_id,
        created_at,
        updated_at,
        is_pinned,
        author:member_profiles!posts_author_id_fkey (
          display_name
        )
      `
      )
      .not('is_deleted', 'is', true)

    if (category !== '전체') {
      query = query.eq('category', category)
    }

    query = query
      .order('is_pinned', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, end)

    const { data, error } = await query

    if (error) {
      console.error('[fetchBoardPosts] Failed to load posts:', error.message)
      return { posts: [], hasNext: false, hasPrev: safePage > 1, currentPage: safePage }
    }

    const posts = data || []
    const hasNext = posts.length > limit

    if (hasNext) {
      posts.pop()
    }

    const basePosts: BoardInitialPost[] = posts.map(row => {
      const rawAuthor = Array.isArray(row.author) ? row.author[0] : row.author
      const preview = createTextPreview(row.content || '', 150)

      return {
        id: row.id,
        title: row.title,
        content: '',
        category: row.category,
        author_id: row.author_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_pinned: row.is_pinned,
        author: rawAuthor?.display_name
          ? {
              name: '',
              email: '',
              display_name: rawAuthor.display_name,
            }
          : undefined,
        content_preview: preview.text,
        preview_has_images: preview.hasImages,
        preview_image_count: preview.imageCount,
        comment_count: 0,
        like_count: 0,
        attachments_stats: {
          total_attachments: 0,
          total_size: 0,
          image_count: 0,
          document_count: 0,
          video_count: 0,
          audio_count: 0,
        } satisfies PostAttachmentStats,
      }
    })

    const postIds = basePosts.map(post => post.id)
    if (postIds.length) {
      const [attachmentResult, commentResult, likeResult] = await Promise.all([
        supabase
          .from('post_attachments')
          .select('post_id, file_type, file_size')
          .in('post_id', postIds),
        supabase.from('comments').select('post_id').in('post_id', postIds),
        supabase.from('post_likes').select('post_id').in('post_id', postIds),
      ])

      if (!attachmentResult.error && attachmentResult.data) {
        const statsMap = new Map<
          string,
          {
            total: number
            totalSize: number
            image: number
            document: number
            video: number
            audio: number
          }
        >()

        attachmentResult.data.forEach(row => {
          const key = String(row.post_id)
          const type = (row.file_type as string) || 'other'
          const current = statsMap.get(key) || {
            total: 0,
            totalSize: 0,
            image: 0,
            document: 0,
            video: 0,
            audio: 0,
          }

          current.total += 1
          current.totalSize += Number(row.file_size) || 0
          if (type === 'image') current.image += 1
          else if (type === 'document') current.document += 1
          else if (type === 'video') current.video += 1
          else if (type === 'audio') current.audio += 1

          statsMap.set(key, current)
        })

        basePosts.forEach(post => {
          const stats = statsMap.get(String(post.id))
          if (stats) {
            post.attachments_stats = {
              total_attachments: stats.total,
              total_size: stats.totalSize,
              image_count: stats.image,
              document_count: stats.document,
              video_count: stats.video,
              audio_count: stats.audio,
            }
            post.preview_has_images = stats.image > 0
            post.preview_image_count = stats.image
          }
        })
      }

      if (!commentResult.error && commentResult.data) {
        const commentCountMap = new Map<string, number>()
        commentResult.data.forEach(row => {
          const key = String(row.post_id)
          commentCountMap.set(key, (commentCountMap.get(key) || 0) + 1)
        })
        basePosts.forEach(post => {
          post.comment_count = commentCountMap.get(post.id) ?? 0
        })
      }

      if (!likeResult.error && likeResult.data) {
        const likeCountMap = new Map<string, number>()
        likeResult.data.forEach(row => {
          const key = String(row.post_id)
          likeCountMap.set(key, (likeCountMap.get(key) || 0) + 1)
        })
        basePosts.forEach(post => {
          post.like_count = likeCountMap.get(post.id) ?? 0
        })
      }
    }

    return {
      posts: basePosts,
      hasNext,
      hasPrev: safePage > 1,
      currentPage: safePage,
    }
  }
)
