import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { stripHtmlTags } from '@/utils/textUtils'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'
export const revalidate = 60

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { searchParams } = request.nextUrl
  const category = searchParams.get('category') || '전체'
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 50)
  const cursor = searchParams.get('cursor') // `${encodeURIComponent(created_at)}|${id}`
  const sortOrder = (searchParams.get('sort') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'
  const searchRaw = searchParams.get('search') || ''

  try {
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
        like_count,
        author:member_profiles!posts_author_id_fkey (display_name)
      `
      )
      .not('is_deleted', 'is', true)

    if (category !== '전체') {
      query = query.eq('category', category)
    }

    if (searchRaw) {
      const tokens = searchRaw
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length >= 2)
        .slice(0, 3)
      if (tokens.length > 0) {
        const esc = (s: string) => s.replace(/'/g, "''").replace(/\\/g, '\\\\')
        const pattern = tokens.map(t => `title.ilike.%${esc(t)}%,content.ilike.%${esc(t)}%`).join(',')
        query = query.or(pattern)
      }
    }

    const ascending = sortOrder === 'asc'
    if (cursor) {
      const [enc, id] = cursor.split('|')
      const createdAt = enc ? decodeURIComponent(enc) : null
      if (createdAt && id) {
        if (ascending) {
          query = query.or(`created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`)
          query = query.order('created_at', { ascending: true }).order('id', { ascending: true })
        } else {
          query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`)
          query = query.order('created_at', { ascending: false }).order('id', { ascending: false })
        }
      }
    } else {
      query = query.order('is_pinned', { ascending: false, nullsFirst: false })
      query = query.order('created_at', { ascending })
      query = query.order('id', { ascending })
    }

    query = query.limit(limit + 1)

    const { data, error } = await query
    if (error) {
      console.error('[API] 게시글 조회 실패:', error)
      return NextResponse.json({ error: '게시글을 불러오는 데 실패했습니다.' }, { status: 500 })
    }

    let actual = data || []
    const hasNext = actual.length > limit
    if (hasNext) actual = actual.slice(0, limit)
    const ids = actual.map((p: any) => p.id)

    // Attachments stats (counts)
    const { data: attRows } = await supabase
      .from('post_attachments')
      .select('post_id, file_type')
      .in('post_id', ids)

    const statsMap = new Map<string, { total: number; image: number; document: number; video: number; audio: number }>()
    ;(attRows || []).forEach((r: any) => {
      const key = r.post_id as string
      const type = (r.file_type as string) || 'document'
      const curr = statsMap.get(key) || { total: 0, image: 0, document: 0, video: 0, audio: 0 }
      curr.total += 1
      if (type === 'image') curr.image += 1
      else if (type === 'video') curr.video += 1
      else if (type === 'audio') curr.audio += 1
      else curr.document += 1
      statsMap.set(key, curr)
    })

    const posts = actual.map((row: any) => {
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
        like_count: row.like_count || 0,
        author: { display_name: row.author?.display_name },
        content_preview: preview,
        preview_has_images: (statsMap.get(row.id)?.image || 0) > 0,
        preview_image_count: statsMap.get(row.id)?.image || 0,
        comment_count: 0,
        attachments_stats: {
          total_attachments: statsMap.get(row.id)?.total || 0,
          image_count: statsMap.get(row.id)?.image || 0,
          document_count: statsMap.get(row.id)?.document || 0,
          video_count: statsMap.get(row.id)?.video || 0,
          audio_count: statsMap.get(row.id)?.audio || 0
        }
      }
    })

    let nextCursor: string | null = null
    if (posts.length > 0 && hasNext) {
      const last = posts[posts.length - 1]
      nextCursor = `${encodeURIComponent(last.created_at)}|${last.id}`
    }

    return NextResponse.json(
      {
        posts,
        pagination: {
          limit,
          has_next: hasNext,
          has_prev: !!cursor,
          next_cursor: nextCursor,
          prev_cursor: null
        },
        filters: {
          category: category === '전체' ? null : category,
          search: searchRaw || null,
          sort_by: 'created_at',
          sort_order: sortOrder
        }
      },
      { status: 200, headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    )
  } catch (e) {
    console.error('[API] 게시글 조회 예외 발생:', e)
    return NextResponse.json({ error: '요청 처리에 실패했습니다.' }, { status: 500 })
  }
}
