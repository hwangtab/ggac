import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { validateUUID } from '@/utils/validation'
import { createLogger } from '@/utils/logger'
import { parseIntegerParam } from '@/utils/queryParams'
import { getPostById } from '@/db/queries/posts'
import { listCommentsKeyset } from '@/db/queries/comments'
import { listAttachments } from '@/db/queries/attachments'

// `dynamic = 'force-dynamic'` 적용으로 ISR `revalidate`는 의미 없음 — 헤더로 캐시 제어.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

const log = createLogger('api/board/post')

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: postId } = await params

  const uuidValidation = validateUUID(postId, '게시글 ID')
  if (!uuidValidation.isValid) {
    return ApiError.badRequest(
      uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
    ).toNextResponse()
  }
  const validPostId = uuidValidation.sanitized

  try {
    const timings: Record<string, number> = {}
    const t0 = Date.now()

    const COMMENTS_PAGE_SIZE = 20

    const t1 = Date.now()
    // 단계 2c 후속(Task 6 확장): posts/member_profiles(저자) 조회에 이어
    // 댓글·첨부도 Supabase에서 Turso 쿼리 계층으로 옮겼다 — 이제 셋 다
    // Turso다. 조회 실패 원인은 삼켜버리지 않고 postFetchError에 남겨 아래
    // 404 로그에서 사유를 구분한다(없음/삭제됨과 DB 조회 자체 실패를 분간할
    // 수 있어야 장애 분류가 된다). 댓글·첨부 실패는 게시글 조회와 독립적으로
    // 흡수해(빈 배열) 부가 정보 실패가 상세 조회 전체를 막지 않게 한다 —
    // 옛 Supabase 클라이언트가 `{data, error}`로 에러를 삼키던 성질과 같다.
    let postFetchError: unknown = null
    const [fullPost, commentsRaw, attachmentsRaw] = await Promise.all([
      getPostById(validPostId, { includeDeleted: false }).catch(error => {
        postFetchError = error
        return null
      }),
      listCommentsKeyset(validPostId, { limit: COMMENTS_PAGE_SIZE }).catch(error => {
        log.error('댓글 조회 실패', error)
        return [] as Awaited<ReturnType<typeof listCommentsKeyset>>
      }),
      listAttachments(validPostId, { orderBy: 'created_at' }).catch(error => {
        log.error('첨부파일 조회 실패', error)
        return [] as Awaited<ReturnType<typeof listAttachments>>
      }),
    ])
    const t2 = Date.now()

    const post = fullPost
      ? {
          id: fullPost.id,
          title: fullPost.title,
          category: fullPost.category,
          author_id: fullPost.author_id,
          created_at: fullPost.created_at,
          author: { display_name: fullPost.author.display_name },
        }
      : null
    const comments = commentsRaw
    // 기존 select 컬럼 집합(file_url/file_type/file_size/is_primary/
    // created_at)과 정확히 맞춘다 — listAttachments는 PostAttachmentRow
    // 전체(15컬럼)를 돌려주는 상위집합이라 명시 투영이 필요하다.
    const attachments = attachmentsRaw.map(att => ({
      file_url: att.file_url,
      file_type: att.file_type,
      file_size: att.file_size,
      is_primary: att.is_primary,
      created_at: att.created_at,
    }))

    timings.queue_ms = t1 - t0
    timings.query_ms = t2 - t1

    if (!post) {
      log.warn('게시글 조회 실패 또는 없음', {
        postFetchError: postFetchError instanceof Error ? postFetchError.message : postFetchError,
        commentsCount: comments.length,
        attachmentsCount: attachments.length,
      })
      return ApiError.notFound('Post not found').toNextResponse()
    }

    const totalSize = attachments.reduce(
      (sum, att) => sum + parseIntegerParam(String(att.file_size ?? ''), 0, { min: 0 }),
      0
    )

    const payload = {
      post: {
        ...post,
        is_liked: false,
        comment_count: comments.length,
        attachments_stats: {
          total_attachments: attachments.length,
          total_size: totalSize,
          image_count: attachments.filter(att => att.file_type === 'image').length,
          document_count: attachments.filter(att => att.file_type === 'document').length,
          video_count: attachments.filter(att => att.file_type === 'video').length,
          audio_count: attachments.filter(att => att.file_type === 'audio').length,
        },
      },
      comments,
      attachments,
      author: (post as { author?: unknown }).author,
    }

    const extraHeaders: Record<string, string> = {}
    if (process.env.POST_DETAIL_TIMING === '1') {
      extraHeaders['x-debug-timing'] = JSON.stringify(timings)
    }
    return ApiSuccess.ok(payload).toNextResponse({
      cacheControl: 'public, s-maxage=60, stale-while-revalidate=300',
      extraHeaders,
    })
  } catch (e) {
    log.error('예상치 못한 오류', e)
    return ApiError.internalServerError('Failed to fetch post detail').toNextResponse()
  }
}
