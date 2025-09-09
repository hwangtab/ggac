import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createErrorResponse, createJsonResponse } from '@/utils/apiResponse'

export const revalidate = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || (!serviceKey && !anonKey)) {
    return createErrorResponse('Supabase credentials not configured', 500)
  }

  const { searchParams } = req.nextUrl
  const category = searchParams.get('category') || '전체'
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 50)

  const supabase = createClient(url, serviceKey || anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Prefer RPC if available for trimmed payload
  const { data, error } = await supabase.rpc('get_posts_preview', {
    p_category: category,
    p_limit: limit,
  })

  if (error) {
    return createErrorResponse(`Failed to fetch previews: ${error.message}`, 500)
  }

  // Shape to client expectation
  const posts = (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    content: '',
    content_format: row.content_format,
    category: row.category,
    author_id: row.author_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_pinned: row.is_pinned,
    like_count: row.like_count,
    author: { display_name: row.author_display_name },
    content_preview: row.content_preview,
    preview_has_images: (row.image_count || 0) > 0,
    preview_image_count: row.image_count || 0,
    comment_count: 0,
    is_liked: false,
    attachments_stats: {
      total_attachments: row.total_attachments || 0,
      image_count: row.image_count || 0,
      document_count: row.document_count || 0,
      video_count: row.video_count || 0,
      audio_count: row.audio_count || 0,
    },
  }))

  return createJsonResponse({ posts, hasNext: posts.length === limit, nextCursor: null }, 200, {
    // Edge-friendly caching
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
  })
}
