import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateUUID } from '@/utils/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

const PAGE_SIZE_MAX = 100

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const uuidValidation = validateUUID(id, '게시글 ID')
  if (!uuidValidation.isValid) {
    return NextResponse.json(
      { success: false, error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.' },
      { status: 400 }
    )
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), PAGE_SIZE_MAX)
  const cursor = searchParams.get('cursor') || ''

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 })
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    try {
      const rpcLimit = limit + 1
      const parts = cursor ? decodeURIComponent(cursor).split('|') : []
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_post_comments_keyset', {
        p_post_id: id,
        p_created_at: parts.length === 2 ? parts[0] : null,
        p_id: parts.length === 2 ? parts[1] : null,
        p_limit: rpcLimit,
      })
      if (!rpcError && Array.isArray(rpcData)) {
        let comments: any[] = rpcData
        const hasNext = comments.length > limit
        if (hasNext) comments = comments.slice(0, limit)
        let nextCursor: string | null = null
        if (hasNext && comments.length > 0) {
          const last = comments[comments.length - 1]
          nextCursor = encodeURIComponent(`${last.created_at}|${last.id}`)
        }
        const normalized = comments.map(c => ({ ...c, like_count: (c as any).like_count ?? 0 }))
        return NextResponse.json({
          success: true,
          data: { comments: normalized, has_next: hasNext, next_cursor: nextCursor },
        })
      }
    } catch {}

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
      query = query.gte('created_at', createdAtCursor).limit(limit + 5)
    } else {
      query = query.limit(limit + 1)
    }

    const { data: rows, error } = await query
    if (error) {
      console.error('[API] 댓글 조회 실패:', error)
      return NextResponse.json(
        { success: false, error: '댓글을 불러오는 데 실패했습니다.' },
        { status: 500 }
      )
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
    console.error('[API] 댓글 조회 예외 발생:', e)
    return NextResponse.json(
      { success: false, error: '요청 처리에 실패했습니다.' },
      { status: 500 }
    )
  }
}
