import { NextRequest } from 'next/server'
import { listCommentsKeyset } from '@/db/queries/comments'
import { getUserLikedCommentIds } from '@/lib/server/commentLikes'
import { validateUUID } from '@/utils/validation'
import { parseIntegerParam } from '@/utils/queryParams'
import { formatTimestampUuidCursor, parseTimestampUuidCursor } from '@/utils/keysetCursor'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { getOptionalUser } from '@/lib/server/memberAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

const PAGE_SIZE_MAX = 100

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const uuidValidation = validateUUID(id, '게시글 ID')
  if (!uuidValidation.isValid) {
    return ApiError.badRequest(
      uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
    ).toNextResponse()
  }
  const postId = uuidValidation.sanitized

  const { searchParams } = new URL(request.url)
  const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: PAGE_SIZE_MAX })
  const cursor = searchParams.get('cursor') || ''
  const parsedCursor = cursor ? parseTimestampUuidCursor(cursor, '댓글 ID') : null
  if (cursor && !parsedCursor) {
    return ApiError.badRequest('유효하지 않은 커서입니다.').toNextResponse()
  }

  // 로그인 여부에 따라 개인화 데이터(댓글 좋아요 여부)를 얹는 선택적
  // 조회다. 비로그인도 댓글 목록을 읽을 수 있어야 하므로 requireUser로
  // 바꾸지 않는다.
  const user = await getOptionalUser()

  const annotateCommentLikeState = async (comments: Array<Record<string, unknown>>) => {
    const commentIds = comments.map(c => String(c.id)).filter(Boolean)
    const likedCommentIds = user
      ? await getUserLikedCommentIds(user.id, commentIds)
      : new Set<string>()

    return comments.map(c => ({
      ...c,
      like_count: parseIntegerParam(String(c.like_count ?? ''), 0, { min: 0 }),
      is_liked: likedCommentIds.has(String(c.id)),
    }))
  }

  try {
    // 단계 2c(Task 6): get_post_comments_keyset RPC 시도 + 실패 시 수동
    // Supabase 폴백 이중 경로를 listCommentsKeyset(Turso) 단일 경로로
    // 대체했다 — 정렬(created_at asc, id asc)과 커서 조건은 그대로다.
    const rpcLimit = limit + 1
    const rows = await listCommentsKeyset(postId, {
      createdAt: parsedCursor?.createdAt ?? null,
      id: parsedCursor?.id ?? null,
      limit: rpcLimit,
    })
    let comments: Array<Record<string, unknown>> = rows as unknown as Array<Record<string, unknown>>

    const hasNext = comments.length > limit
    if (hasNext) comments = comments.slice(0, limit)

    let nextCursor: string | null = null
    if (hasNext && comments.length > 0) {
      const last = comments[comments.length - 1] as { created_at: string; id: string }
      nextCursor = formatTimestampUuidCursor(last.created_at, last.id)
    }

    const normalized = await annotateCommentLikeState(comments)
    return ApiSuccess.ok({
      comments: normalized,
      has_next: hasNext,
      next_cursor: nextCursor,
    }).toNextResponse()
  } catch (e) {
    console.error('[API] 댓글 조회 예외 발생:', e)
    return ApiError.internalServerError('요청 처리에 실패했습니다.').toNextResponse()
  }
}
