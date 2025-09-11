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
  const refresh = searchParams.get('refresh')

  const supabase = createClient(url, serviceKey || anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Direct query instead of RPC to avoid schema issues
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

  // Apply category filter
  if (category !== '전체') {
    query = query.eq('category', category)
  }

  // Apply ordering and limit
  query = query
    .order('is_pinned', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  const { data, error } = await query

  if (error) {
    return createErrorResponse(`Failed to fetch posts: ${error.message}`, 500)
  }

  // Shape to client expectation
  const posts = (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    content: '',
    category: row.category,
    author_id: row.author_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_pinned: row.is_pinned,
    author: { display_name: row.author?.display_name },
    content_preview: (row.content || '').substring(0, 150) + '...',
    preview_has_images: false,
    preview_image_count: 0,
    comment_count: 0,
    is_liked: false,
    attachments_stats: {
      total_attachments: 0,
      image_count: 0,
      document_count: 0,
      video_count: 0,
      audio_count: 0,
    },
  }))

  return createJsonResponse({ posts, hasNext: posts.length === limit, nextCursor: null }, 200, {
    // Edge-friendly caching, but disable if refresh parameter is present
    'Cache-Control': refresh
      ? 'no-cache, no-store, must-revalidate'
      : 'public, s-maxage=60, stale-while-revalidate=300',
  })
}
