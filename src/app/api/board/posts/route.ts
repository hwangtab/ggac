import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createErrorResponse, createJsonResponse } from '@/utils/apiResponse'
import { stripHtmlTags } from '@/utils/textUtils'

export const revalidate = 60
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  console.info('[API board/posts] env check', {
    hasUrl: Boolean(url),
    hasServiceKey: Boolean(serviceKey),
    hasAnonKey: Boolean(anonKey),
    runtime: 'nodejs',
  })
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
    console.warn('[API board/posts] query error', {
      message: error.message,
      code: (error as any).code,
    })
    return createErrorResponse(`Failed to fetch posts: ${error.message}`, 500)
  }

  const basePosts = (data || []).map((row: any) => {
    const clean = stripHtmlTags(row.content || '')
    const preview = clean.length > 150 ? `${clean.substring(0, 150)}...` : clean
    return {
      id: row.id,
      title: row.title,
      content: '',
      category: row.category,
      author_id: row.author_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_pinned: row.is_pinned,
      author: { display_name: row.author?.display_name },
      content_preview: preview,
      preview_has_images: false,
      preview_image_count: 0,
      comment_count: 0,
      is_liked: false,
      attachments_stats: {
        total_attachments: 0,
        total_size: 0,
        image_count: 0,
        document_count: 0,
        video_count: 0,
        audio_count: 0,
      },
    }
  })

  // Enrich with aggregated attachment stats
  try {
    const ids = basePosts.map(p => p.id)
    if (ids.length > 0) {
      const { data: attRows } = await supabase
        .from('post_attachments')
        .select('post_id, file_type, file_size')
        .in('post_id', ids)

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
      ;(attRows || []).forEach((r: any) => {
        const key = r.post_id as string
        const type = (r.file_type as string) || 'other'
        const cnt = 1
        const curr = statsMap.get(key) || {
          total: 0,
          totalSize: 0,
          image: 0,
          document: 0,
          video: 0,
          audio: 0,
        }
        curr.total += cnt
        curr.totalSize += Number(r.file_size) || 0
        if (type === 'image') curr.image += cnt
        else if (type === 'document') curr.document += cnt
        else if (type === 'video') curr.video += cnt
        else if (type === 'audio') curr.audio += cnt
        statsMap.set(key, curr)
      })

      for (const p of basePosts as any[]) {
        const s = statsMap.get(p.id)
        if (s) {
          p.attachments_stats = {
            total_attachments: s.total,
            total_size: s.totalSize,
            image_count: s.image,
            document_count: s.document,
            video_count: s.video,
            audio_count: s.audio,
          }
          p.preview_has_images = s.image > 0
          p.preview_image_count = s.image
        }
      }
    }
  } catch {}

  const posts = basePosts

  return createJsonResponse({ posts, hasNext: posts.length === limit, nextCursor: null }, 200, {
    // Edge-friendly caching, but disable if refresh parameter is present
    'Cache-Control': refresh
      ? 'no-cache, no-store, must-revalidate'
      : 'public, s-maxage=60, stale-while-revalidate=300',
  })
}
