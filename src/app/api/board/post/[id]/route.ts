import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createErrorResponse, createJsonResponse } from '@/utils/apiResponse'

export const revalidate = 60
export const dynamic = 'force-dynamic'

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

    const attachmentsQuery = supabase
      .from('post_attachments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })

    const [{ data: post, error: postError }, { data: comments = [] }, { data: attachments = [] }] =
      await Promise.all([postQuery, commentsQuery, attachmentsQuery])

    if (postError || !post) {
      return createErrorResponse('Post not found', 404)
    }

    const payload = {
      post: {
        ...post,
        is_liked: false,
        comment_count: (comments || []).length,
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

    return createJsonResponse(payload, 200, {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    })
  } catch (e: any) {
    return createErrorResponse('Failed to fetch post detail', 500)
  }
}
