// 서버 컴포넌트: 초기 게시글 데이터를 ISR로 제공
import { createClient } from '@supabase/supabase-js'
import { headers } from 'next/headers'
import BoardClient from './BoardClient'
import { createTextPreview } from '@/utils/textUtils'
import type { Post, PostAttachmentStats } from '@/types'

// ISR 설정 - 60초마다 재검증
export const revalidate = 60

interface ServerDataProps {
  category?: string
  limit?: number
  refreshKey?: string
}

type BoardInitialPost = Post & {
  content_preview: string
  preview_has_images: boolean
  preview_image_count: number
  attachments_stats: NonNullable<Post['attachments_stats']>
}

interface InitialPostsData {
  posts: BoardInitialPost[]
  hasNext: boolean
  nextCursor: string | null
}

// 서버 사이드에서 초기 게시글 데이터 조회
async function getInitialPosts(
  category: string = '전체',
  limit: number = 20
): Promise<InitialPostsData> {
  // Service role 클라이언트 생성 (서버에서만 사용)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    console.error('NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다')
    return { posts: [], hasNext: false, nextCursor: null }
  }

  const supabaseAdmin = key
    ? createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
        auth: { autoRefreshToken: false, persistSession: false },
      })

  try {
    let query = supabaseAdmin
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

    // 카테고리 필터 적용
    if (category !== '전체') {
      query = query.eq('category', category)
    }

    // 정렬 및 제한
    query = query
      .order('is_pinned', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1) // 다음 페이지 존재 여부 확인을 위해 +1

    const { data: posts, error } = await query

    if (error) {
      console.error('서버 게시글 조회 오류:', error)
      return {
        posts: [],
        hasNext: false,
        nextCursor: null,
      }
    }

    const actualPosts = posts || []
    const hasNext = actualPosts.length > limit

    if (hasNext) {
      actualPosts.pop() // 초과분 제거
    }

    const basePosts: BoardInitialPost[] = actualPosts.map(post => {
      const rawAuthor = Array.isArray(post.author) ? post.author[0] : post.author
      const authorDisplayName = rawAuthor?.display_name
      const preview = createTextPreview(post.content || '', 150)
      return {
        id: post.id,
        title: post.title,
        content: '',
        category: post.category,
        author_id: post.author_id,
        created_at: post.created_at,
        updated_at: post.updated_at,
        is_pinned: post.is_pinned,
        author: authorDisplayName
          ? {
              name: '',
              email: '',
              display_name: authorDisplayName,
            }
          : undefined,
        content_preview: preview.text,
        preview_has_images: preview.hasImages,
        preview_image_count: preview.imageCount,
        comment_count: 0,
        is_liked: false,
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
      const { data: attachmentRows, error: attachmentError } = await supabaseAdmin
        .from('post_attachments')
        .select('post_id, file_type, file_size')
        .in('post_id', postIds)

      if (!attachmentError && attachmentRows) {
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

        attachmentRows.forEach(row => {
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
    }

    let nextCursor: string | null = null
    if (hasNext && actualPosts.length > 0) {
      const lastPost = actualPosts[actualPosts.length - 1]
      nextCursor = `${encodeURIComponent(lastPost.created_at)}|${lastPost.id}`
    }

    return {
      posts: basePosts,
      hasNext,
      nextCursor,
    }
  } catch (error) {
    console.error('초기 게시글 데이터 조회 실패:', error)
    console.error('카테고리:', category, '제한:', limit)
    return {
      posts: [],
      hasNext: false,
      nextCursor: null,
    }
  }
}

// 서버 컴포넌트
export default async function BoardServerData({
  category = '전체',
  limit = 15,
  refreshKey,
}: ServerDataProps) {
  let initialData: InitialPostsData = { posts: [], hasNext: false, nextCursor: null }

  try {
    const h = await headers()
    const proto = h.get('x-forwarded-proto') || 'https'
    const host = h.get('x-forwarded-host') || h.get('host') || ''
    const search = new URLSearchParams({
      category,
      limit: String(limit),
    })
    if (refreshKey) {
      search.set('refresh', refreshKey)
    }

    if (host) {
      const apiUrl = `${proto}://${host}/api/board/posts?${search.toString()}`
      const res = await fetch(apiUrl, {
        next: refreshKey
          ? { revalidate: 0 }
          : { revalidate: 60, tags: ['board-initial', `board-${category}`] },
      })

      if (res.ok) {
        const json = (await res.json()) as Partial<InitialPostsData>
        initialData = {
          posts: (json.posts as BoardInitialPost[]) || [],
          hasNext: Boolean(json.hasNext),
          nextCursor: json.nextCursor ?? null,
        }
      } else {
        console.warn('Board API responded with status', res.status)
      }
    }
  } catch (error) {
    console.warn('Board API fetch failed, falling back to direct query:', error)
  }

  if (!initialData.posts.length) {
    initialData = await getInitialPosts(category, limit)
  }

  return <BoardClient initialData={initialData} />
}
