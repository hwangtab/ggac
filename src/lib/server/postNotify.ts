// 상대경로 + 명시적 확장자로 임포트한다 — commentNotify.ts와 같은 이유
// (plain `node --test`에서 `@/` 별칭이 풀리지 않는다).
import { listProfiles } from '../../db/queries/profiles.ts'
import { createBulkNotifications } from '../../db/queries/notifications.ts'
import { createLogger } from '../../utils/logger.ts'

const log = createLogger('postNotify')

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// `src/lib/server/boardRoomAuth.ts`의 `APPROVED_ROSTER_PAGE_LIMIT`와 같은 이유
// — "전체 승인 회원" 로스터를 페이지네이션 없이 한 번에 담는다.
const APPROVED_MEMBERS_PAGE_LIMIT = 10000

export type NotifyNewPostInput = {
  postId: string
  authorId: string
  title: string
  category: string
}

/**
 * 공지 게시글 알림(`post_new`) 발송. `category === '공지'`인 경우에만,
 * `registration_status = 'approved'`인 모든 회원에게 **배치 INSERT 1회**로
 * 보낸다. 실패는 로깅만 하고 본 작업 흐름(게시글 작성)을 막지 않는다 —
 * 호출부는 이 함수가 절대 throw하지 않는다고 가정하고 그냥 `await`한다.
 *
 * 원본: `supabase/migrations/20250719090050_create_notifications_table.sql`의
 * `notify_new_post()` 트리거 — 운영 DB에 적용된 적이 없다(전수감사로 확인).
 * 원본은 회원마다 `create_notification`을 호출하는 `FOR` 루프였다(N+1) —
 * 이 함수는 그 대신 `createBulkNotifications`(배치 INSERT 1회)를 쓴다.
 * `related_post_id`/`related_user_id`는 원본 트리거처럼 모든 수신자에게
 * 공통으로 붙는다(`createBulkNotifications`가 이 전환을 위해 그 두 인자를
 * 받도록 확장됐다 — 원본 `create_bulk_notification` RPC에는 없던 인자).
 */
export async function notifyNewPost(input: NotifyNewPostInput): Promise<void> {
  if (input.category !== '공지') return

  let recipientIds: string[]
  try {
    const { rows } = await listProfiles({
      status: 'approved',
      limit: APPROVED_MEMBERS_PAGE_LIMIT,
      offset: 0,
    })
    recipientIds = rows.map(row => row.id)
  } catch (e) {
    log.error('승인 회원 명단 조회 실패 — 공지 알림을 건너뛴다', {
      postId: input.postId,
      error: (e as Error).message,
    })
    return
  }

  if (recipientIds.length === 0) return

  try {
    await createBulkNotifications({
      user_ids: recipientIds,
      type: 'post_new',
      title: '새 공지사항이 등록되었습니다',
      message: input.title,
      data: { post_id: input.postId, category: input.category },
      related_post_id: input.postId,
      related_user_id: input.authorId,
      expires_at: new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
    })
  } catch (e) {
    log.error('공지 알림 일괄 발송 실패', {
      postId: input.postId,
      count: recipientIds.length,
      error: (e as Error).message,
    })
  }
}
