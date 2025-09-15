import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createErrorResponse, createJsonResponse } from '@/utils/apiResponse'

export const revalidate = 60
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const postId = id

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || (!serviceKey && !anonKey)) {
    return createErrorResponse('Supabase credentials not configured', 500)
  }

  const supabase = createClient(url, serviceKey || anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const timings: Record<string, number> = {}
    const t0 = Date.now()
    const postQuery = supabase
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
        like_count,
        view_count,
        is_pinned,
        author:member_profiles!posts_author_id_fkey (
          display_name
        )
      `
      )
      .eq('id', postId)
      .not('is_deleted', 'is', true)
      .single()

    const COMMENTS_PAGE_SIZE = 30
    const commentsQuery = supabase
      .from('comments')
      .select(
        `
        id,
        content,
        author_id,
        created_at,
        like_count,
        parent_id,
        author:member_profiles!comments_author_id_fkey (display_name)
      `
      )
      .eq('post_id', postId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .range(0, COMMENTS_PAGE_SIZE - 1)

    const attachmentsQuery = supabase
      .from('post_attachments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })

    const t1 = Date.now()
    const [postRes, commentsRes, attachmentsRes] = await Promise.all([
      postQuery,
      commentsQuery,
      attachmentsQuery,
    ])
    const t2 = Date.now()

    const { data: post, error: postError } = postRes
    const comments = (commentsRes.data as any[]) || []
    const attachments = (attachmentsRes.data as any[]) || []

    timings.queue_ms = t1 - t0
    timings.query_ms = t2 - t1

    if (postError || !post) {
      return createErrorResponse('Post not found', 404)
    }

    const payload = {
      post: {
        ...post,
        is_liked: false,
        comment_count: (comments || []).length, // 전체 개수는 별도 API로 제공 가능
        attachments_stats: {
          total_attachments: (attachments || []).length,
          image_count: (attachments || []).filter((att: any) => att.file_type === 'image').length,
          document_count: (attachments || []).filter((att: any) => att.file_type === 'document')
            .length,
          video_count: (attachments || []).filter((att: any) => att.file_type === 'video').length,
          audio_count: (attachments || []).filter((att: any) => att.file_type === 'audio').length,
        },
      },
      comments,
      attachments,
      author: post.author,
    }

    const headers: Record<string, string> = {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    }
    if (process.env.POST_DETAIL_TIMING === '1') {
      headers['x-debug-timing'] = JSON.stringify(timings)
    }
    return createJsonResponse(payload, 200, headers)
  } catch (e: any) {
    return createErrorResponse('Failed to fetch post detail', 500)
  }
}
