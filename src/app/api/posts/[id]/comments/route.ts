import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getUserLikedCommentIds } from '@/lib/server/commentLikes'
import { revalidateTag } from 'next/cache'
import { validateUUID } from '@/utils/validation'
import { parseIntegerParam } from '@/utils/queryParams'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { formatTimestampUuidCursor, parseTimestampUuidCursor } from '@/utils/keysetCursor'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

const PAGE_SIZE_MAX = 100

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const uuidValidation = validateUUID(id, '게시글 ID')
  if (!uuidValidation.isValid) {
    return ApiError.badRequest(uuidValidation.errors[0]).toNextResponse()
  }
  const postId = uuidValidation.sanitized
  const { searchParams } = new URL(request.url)
  const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: PAGE_SIZE_MAX })
  const cursor = searchParams.get('cursor') || '' // format: encodeURIComponent(`${created_at}|${id}`)
  const parsedCursor = cursor ? parseTimestampUuidCursor(cursor, '댓글 ID') : null
  if (cursor && !parsedCursor) {
    return ApiError.badRequest('유효하지 않은 커서입니다.').toNextResponse()
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return ApiError.internalServerError('Supabase not configured').toNextResponse()
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
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
      return ApiError.internalServerError('댓글 조회에 실패했습니다.').toNextResponse()
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
    return ApiSuccess.ok({
      comments: normalized,
      has_next: hasNext,
      next_cursor: nextCursor,
    }).toNextResponse()
  } catch (e) {
    console.error('[API] 댓글 GET 오류:', e)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // 댓글 작성은 승인 회원 계정 하나로 무한 반복이 가능하던 공백(전수감사 안정성 M-4)
  const rl = await rateLimit(request, 'POST_CREATION')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const { id: postId } = await context.params
  const postIdValidation = validateUUID(postId, '게시글 ID')
  if (!postIdValidation.isValid) {
    return ApiError.badRequest(postIdValidation.errors[0]).toNextResponse()
  }
  const validPostId = postIdValidation.sanitized
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id
    if (!userId) return ApiError.unauthorized('Unauthorized').toNextResponse()

    const body = await parseJsonObjectBody(request)
    if (!body) {
      return ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse()
    }

    const content = (body?.content || '').toString().trim()
    if (!content) return ApiError.badRequest('내용이 비어있습니다.').toNextResponse()

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', userId)
      .maybeSingle()
    const isMember =
      !!profile && (profile as any).registration_status === 'approved' && (profile as any).is_active
    if (!isMember) return ApiError.forbidden('권한이 없습니다.').toNextResponse()

    const { data, error } = await supabase
      .from('comments')
      .insert([{ post_id: validPostId, author_id: userId, content }])
      .select('id, content, author_id, created_at')
      .single()
    if (error) {
      console.error('[API] 댓글 작성 오류:', error)
      return ApiError.internalServerError('댓글 작성에 실패했습니다.').toNextResponse()
    }

    try {
      revalidateTag(`comments-post-${validPostId}`)
      revalidateTag(`attachments-post-${validPostId}`)
      revalidateTag('board-post')
      revalidateTag(validPostId)
    } catch (revalidateError) {
      console.error('[API] 캐시 재검증 실패:', revalidateError)
    }

    return ApiSuccess.ok(data).toNextResponse()
  } catch (e) {
    console.error('[API] 댓글 POST 오류:', e)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
