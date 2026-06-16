import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'
import { revalidateTag } from 'next/cache'
import { validateUUID } from '@/utils/validation'
import { parseIntegerParam } from '@/utils/queryParams'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { formatTimestampUuidCursor, parseTimestampUuidCursor } from '@/utils/keysetCursor'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

const PAGE_SIZE_MAX = 100

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const uuidValidation = validateUUID(id, '게시글 ID')
  if (!uuidValidation.isValid) {
    return NextResponse.json({ success: false, error: uuidValidation.errors[0] }, { status: 400 })
  }
  const postId = uuidValidation.sanitized
  const { searchParams } = new URL(request.url)
  const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: PAGE_SIZE_MAX })
  const cursor = searchParams.get('cursor') || '' // format: encodeURIComponent(`${created_at}|${id}`)
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

  try {
    let query = supabase
      .from('comments')
      .select(
        `
        id,
        content,
        author_id,
        created_at,
        like_count,
        author:member_profiles!comments_author_id_fkey (display_name)
      `
      )
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    if (parsedCursor) {
      // Fetch a small superset and filter in memory to emulate (created_at, id) keyset
      query = query.gte('created_at', parsedCursor.createdAt).limit(limit + 5)
    } else {
      query = query.limit(limit + 1)
    }

    const { data: rows, error } = await query
    if (error) {
      console.error('[API] 댓글 조회 오류:', error)
      return NextResponse.json(
        { success: false, error: '댓글 조회에 실패했습니다.' },
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

    const normalized = (comments as any[]).map(c => ({
      ...c,
      like_count: (c as any).like_count ?? 0,
    }))
    return NextResponse.json({
      success: true,
      data: { comments: normalized, has_next: hasNext, next_cursor: nextCursor },
    })
  } catch (e) {
    console.error('[API] 댓글 GET 오류:', e)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: postId } = await context.params
  const postIdValidation = validateUUID(postId, '게시글 ID')
  if (!postIdValidation.isValid) {
    return NextResponse.json({ success: false, error: postIdValidation.errors[0] }, { status: 400 })
  }
  const validPostId = postIdValidation.sanitized
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id
    if (!userId)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const body = await parseJsonObjectBody(request)
    if (!body) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 JSON 본문입니다.' },
        { status: 400 }
      )
    }

    const content = (body?.content || '').toString().trim()
    if (!content)
      return NextResponse.json({ success: false, error: '내용이 비어있습니다.' }, { status: 400 })

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', userId)
      .maybeSingle()
    const isMember =
      !!profile && (profile as any).registration_status === 'approved' && (profile as any).is_active
    if (!isMember)
      return NextResponse.json({ success: false, error: '권한이 없습니다.' }, { status: 403 })

    const { data, error } = await supabase
      .from('comments')
      .insert([{ post_id: validPostId, author_id: userId, content }])
      .select('id, content, author_id, created_at')
      .single()
    if (error) {
      console.error('[API] 댓글 작성 오류:', error)
      return NextResponse.json(
        { success: false, error: '댓글 작성에 실패했습니다.' },
        { status: 500 }
      )
    }

    try {
      revalidateTag(`comments-post-${validPostId}`)
      revalidateTag(`attachments-post-${validPostId}`)
      revalidateTag('board-post')
      revalidateTag(validPostId)
    } catch (revalidateError) {
      console.error('[API] 캐시 재검증 실패:', revalidateError)
    }

    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error('[API] 댓글 POST 오류:', e)
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
