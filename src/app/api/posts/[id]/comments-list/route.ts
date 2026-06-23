import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getUserLikedCommentIds } from '@/lib/server/commentLikes'
import { validateUUID } from '@/utils/validation'
import { parseIntegerParam } from '@/utils/queryParams'
import { formatTimestampUuidCursor, parseTimestampUuidCursor } from '@/utils/keysetCursor'

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
  const postId = uuidValidation.sanitized

  const { searchParams } = new URL(request.url)
  const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: PAGE_SIZE_MAX })
  const cursor = searchParams.get('cursor') || ''
  const parsedCursor = cursor ? parseTimestampUuidCursor(cursor, '댓글 ID') : null
  if (cursor && !parsedCursor) {
    return NextResponse.json(
      { success: false, error: '유효하지 않은 커서입니다.' },
      { status: 400 }
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 })
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const sessionSupabase = await createSupabaseServer()
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser()

  const annotateCommentLikeState = async (comments: Array<Record<string, unknown>>) => {
    const commentIds = comments.map(c => String(c.id)).filter(Boolean)
    const likedCommentIds = user
      ? await getUserLikedCommentIds(sessionSupabase, user.id, commentIds)
      : new Set<string>()

    return comments.map(c => ({
      ...c,
      like_count: parseIntegerParam(String(c.like_count ?? ''), 0, { min: 0 }),
      is_liked: likedCommentIds.has(String(c.id)),
    }))
  }

  try {
    try {
      const rpcLimit = limit + 1
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_post_comments_keyset', {
        p_post_id: postId,
        p_created_at: parsedCursor?.createdAt ?? null,
        p_id: parsedCursor?.id ?? null,
        p_limit: rpcLimit,
      })
      if (!rpcError && Array.isArray(rpcData)) {
        let comments: any[] = rpcData
        const hasNext = comments.length > limit
        if (hasNext) comments = comments.slice(0, limit)
        let nextCursor: string | null = null
        if (hasNext && comments.length > 0) {
          const last = comments[comments.length - 1]
          nextCursor = formatTimestampUuidCursor(last.created_at, last.id)
        }
        const normalized = await annotateCommentLikeState(comments)
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
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    if (parsedCursor) {
      query = query.gte('created_at', parsedCursor.createdAt).limit(limit + 5)
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
    if (parsedCursor) {
      comments = comments.filter(
        (r: any) =>
          r.created_at > parsedCursor.createdAt ||
          (r.created_at === parsedCursor.createdAt && r.id > parsedCursor.id)
      )
    }

    const hasNext = comments.length > limit
    if (hasNext) comments = comments.slice(0, limit)

    let nextCursor: string | null = null
    if (hasNext && comments.length > 0) {
      const last = comments[comments.length - 1]
      nextCursor = formatTimestampUuidCursor(last.created_at, last.id)
    }

    const normalized = await annotateCommentLikeState(comments as Array<Record<string, unknown>>)
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
