import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

const PAGE_SIZE_MAX = 100

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), PAGE_SIZE_MAX)
  const cursor = searchParams.get('cursor') || '' // format: encodeURIComponent(`${created_at}|${id}`)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || (!serviceKey && !anonKey)) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 })
  }

  const supabase = createClient(url, serviceKey || anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    let query = supabase
      .from('comments')
      .select(
        `
        id,
        content,
        author_id,
        created_at,
        author:member_profiles!comments_author_id_fkey (display_name)
      `
      )
      .eq('post_id', id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    let createdAtCursor: string | null = null
    let idCursor: string | null = null

    if (cursor) {
      const parts = decodeURIComponent(cursor).split('|')
      if (parts.length === 2) {
        createdAtCursor = parts[0]
        idCursor = parts[1]
      }
    }

    if (createdAtCursor && idCursor) {
      // Fetch a small superset and filter in memory to emulate (created_at, id) keyset
      query = query.gte('created_at', createdAtCursor).limit(limit + 5)
    } else {
      query = query.limit(limit + 1)
    }

    const { data: rows, error } = await query
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    let comments = rows || []
    if (createdAtCursor && idCursor) {
      comments = comments.filter(
        (r: any) =>
          r.created_at > createdAtCursor! || (r.created_at === createdAtCursor && r.id > idCursor!)
      )
    }

    const hasNext = comments.length > limit
    if (hasNext) comments = comments.slice(0, limit)

    let nextCursor: string | null = null
    if (hasNext && comments.length > 0) {
      const last = comments[comments.length - 1]
      nextCursor = encodeURIComponent(`${last.created_at}|${last.id}`)
    }

    const normalized = (comments as any[]).map(c => ({
      ...c,
      like_count: (c as any).like_count ?? 0,
    }))
    return NextResponse.json({
      success: true,
      data: { comments: normalized, has_next: hasNext, next_cursor: nextCursor },
    })
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || 'Unexpected error' },
      { status: 500 }
    )
  }
}
