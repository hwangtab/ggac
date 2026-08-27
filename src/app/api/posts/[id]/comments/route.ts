import { NextRequest, NextResponse } from 'next/server'
import { createComment, listCommentsKeyset } from '@/db/queries/comments'
import { getPostById } from '@/db/queries/posts'
import { getLikedCommentIds } from '@/db/queries/likes'
import { revalidateTag } from 'next/cache'
import { validateUUID } from '@/utils/validation'
import { parseIntegerParam } from '@/utils/queryParams'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { formatTimestampUuidCursor, parseTimestampUuidCursor } from '@/utils/keysetCursor'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'
import { requireActiveMember, getOptionalUser } from '@/lib/server/memberAuth'
import { notifyNewComment } from '@/lib/server/commentNotify'

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

  try {
    // 로그인 여부에 따라 개인화 데이터(댓글 좋아요 여부)를 얹는 선택적
    // 조회다. 비로그인도 댓글 목록을 읽을 수 있어야 하므로 requireUser로
    // 바꾸지 않는다.
    const user = await getOptionalUser()
    const annotateCommentLikeState = async (comments: Array<Record<string, unknown>>) => {
      const commentIds = comments.map(c => String(c.id)).filter(Boolean)
      const likedCommentIds = user
        ? await getLikedCommentIds(user.id, commentIds)
        : new Set<string>()

      return comments.map(c => ({
        ...c,
        like_count: parseIntegerParam(String(c.like_count ?? ''), 0, { min: 0 }),
        is_liked: likedCommentIds.has(String(c.id)),
      }))
    }

    // 단계 2c(Task 6): get_post_comments_keyset RPC + 수동 Supabase 폴백을
    // listCommentsKeyset(Turso)로 대체 — 정렬(created_at asc, id asc)과 커서
    // 조건((created_at > c) OR (created_at = c AND id > i))을 그대로 옮긴다.
    const rows = await listCommentsKeyset(postId, {
      createdAt: parsedCursor?.createdAt ?? null,
      id: parsedCursor?.id ?? null,
      limit: limit + 1,
    })

    let comments: Array<Record<string, unknown>> = rows.map(row => ({
      id: row.id,
      content: row.content,
      author_id: row.author_id,
      created_at: row.created_at,
      like_count: row.like_count,
      author: row.author,
    }))

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
    // 댓글 작성은 로그인 + 승인된 활성 멤버만 가능한 강제 검사였다.
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth
    const userId = user.id

    const body = await parseJsonObjectBody(request)
    if (!body) {
      return ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse()
    }

    const content = (body?.content || '').toString().trim()
    if (!content) return ApiError.badRequest('내용이 비어있습니다.').toNextResponse()

    // 글이 실재하고 삭제되지 않았는지 먼저 본다.
    //
    // 예전에는 이 검사가 없어서 **소프트 삭제된 글에 댓글이 저장됐다**(적대
    // 감사 2026-08-27 실측: 200 성공, DB에 실제 저장). 그 댓글은 글이 404라
    // 아무도 볼 수 없고, 알림도 `commentNotify`에서 경고만 남기고 사라진다 —
    // 쓴 사람만 성공했다고 믿는다. 형제 경로인 좋아요는 이미 막고 있었다
    // (`likes/route.ts`의 `post.is_deleted` 분기).
    //
    // 없는 글에 대해 FK 위반이 그대로 500으로 새어 나가던 것도 404로 바꾼다.
    const post = await getPostById(validPostId, { includeDeleted: true })
    if (!post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }
    if (post.is_deleted) {
      return ApiError.badRequest('삭제된 게시글에는 댓글을 쓸 수 없습니다.').toNextResponse()
    }

    const created = await createComment({ post_id: validPostId, author_id: userId, content })
    const data = {
      id: created.id,
      content: created.content,
      author_id: created.author_id,
      created_at: created.created_at,
    }

    try {
      revalidateTag(`comments-post-${validPostId}`)
      revalidateTag(`attachments-post-${validPostId}`)
      revalidateTag('board-post')
      revalidateTag(validPostId)
    } catch (revalidateError) {
      console.error('[API] 캐시 재검증 실패:', revalidateError)
    }

    // 알림 발송 실패는 로깅만 하고 댓글 작성 응답을 막지 않는다
    // (notifyNewComment 내부에서 이미 흡수한다).
    await notifyNewComment({
      postId: validPostId,
      commentId: created.id,
      commentAuthorId: userId,
    })

    return ApiSuccess.ok(data).toNextResponse()
  } catch (e) {
    console.error('[API] 댓글 POST 오류:', e)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
