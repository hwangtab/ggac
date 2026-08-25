// 상대경로 + 명시적 확장자로 임포트한다(`src/db/queries/*.ts`와 같은 이유) —
// `@/` 별칭은 Next.js/webpack 빌드에서만 풀리고, `scripts/testing/*.test.mjs`가
// 쓰는 plain `node --experimental-strip-types --test`에서는 풀리지 않는다.
// 이 파일을 테스트가 실제 코드로 직접 import해 검증할 수 있어야 하므로
// `@/lib/server/boardRoomAuth`처럼 별칭을 쓰지 않는다.
import { getPostById } from '../../db/queries/posts.ts'
import { createNotification } from '../../db/queries/notifications.ts'
import { createLogger } from '../../utils/logger.ts'

const log = createLogger('commentNotify')

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export type NotifyNewCommentInput = {
  postId: string
  commentId: string
  commentAuthorId: string
}

/**
 * 댓글 알림(`post_reply`) 발송. 실패는 로깅만 하고 본 작업 흐름(댓글 작성)을
 * 막지 않는다 — 호출부는 이 함수가 절대 throw하지 않는다고 가정하고 그냥
 * `await`한다(`boardRoomNotify.notifyDirectors`와 같은 계약).
 *
 * 원본: `supabase/migrations/20250719090050_create_notifications_table.sql`의
 * `notify_new_comment()` 트리거 — 운영 DB에 적용된 적이 없다(전수감사로
 * 확인). 게시글 작성자와 댓글 작성자가 같으면 보내지 않는다는 조건
 * (`post_author_id != NEW.author_id`)을 그대로 옮긴다.
 */
export async function notifyNewComment(input: NotifyNewCommentInput): Promise<void> {
  const { postId, commentId, commentAuthorId } = input

  let post
  try {
    post = await getPostById(postId)
  } catch (e) {
    log.error('게시글 조회 실패 — 댓글 알림을 건너뛴다', {
      postId,
      commentId,
      error: (e as Error).message,
    })
    return
  }
  if (!post) return

  // 자기 글에 자기가 단 댓글은 알림을 보내지 않는다(원본 트리거의
  // `post_author_id != NEW.author_id` 조건).
  if (post.author_id === commentAuthorId) return

  try {
    await createNotification({
      user_id: post.author_id,
      type: 'post_reply',
      title: '댓글이 달렸습니다',
      message: `${post.title}에 새로운 댓글이 달렸습니다.`,
      data: { post_id: postId, comment_id: commentId },
      related_post_id: postId,
      related_user_id: commentAuthorId,
      expires_at: new Date(Date.now() + THIRTY_DAYS_MS).toISOString(),
    })
  } catch (e) {
    log.error('댓글 알림 발송 실패', { postId, commentId, error: (e as Error).message })
  }
}
