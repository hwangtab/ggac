import { NextRequest } from 'next/server'
import { listCommentsKeyset } from '@/db/queries/comments'
import { getLikedCommentIds } from '@/db/queries/likes'
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
    // 개인화(하트 채움) 조회는 목록 자체의 성패와 분리한다. getLikedCommentIds는
    // 이 저장소의 다른 쿼리 계층 함수처럼 실패 시 throw하는데, 그 예외를 그대로
    // 두면 아래 catch가 500으로 바꿔 **댓글 섹션이 통째로 사라진다**(로그인
    // 사용자만 — 비로그인은 이 조회를 아예 안 탄다). 형제 라우트 둘
    // (`posts/route.ts`의 getLikedPostIds, `posts/[id]/route.ts`의
    // getLikedCommentIds)은 같은 조회를 이미 `.catch()`로 흡수하고 근거도 같다:
    // 하트만 안 채워지는 게 목록이 통째로 사라지는 것보다 낫다. 옛 Supabase
    // 클라이언트가 `{data, error}`로 삼키던 성질을 여기서만 잃어버려 형제와
    // 어긋나 있었다(최종 리뷰 B-5). 실제 댓글 화면이 쓰는 건 이 라우트다.
    const likedCommentIds = user
      ? await getLikedCommentIds(user.id, commentIds).catch(error => {
          console.error('[API] 댓글 좋아요 조회 실패 — 하트 없이 계속 진행:', error)
          return new Set<string>()
        })
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
