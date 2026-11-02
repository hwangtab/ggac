'use server'

import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import {
  markActivitySeenRow,
  markAllMentionsReadRows,
  markMentionReadRow,
  removeBookmarkRow,
} from '@/db/queries/work/inbox'
import { dbFailure, invalid, ok, type ActionResult } from '@work/lib/channels/action-result'
import { messageIdSchema } from '@work/lib/messages/schema'

/**
 * 받은 멘션·북마크·활동 server action — 원본 kosmart-work `lib/inbox/actions.ts`와 같은 이름·모양.
 * 본인 행만 바뀐다: user_id는 가드의 사용자로 고정해 쿼리에 넘긴다(원본 RLS + .eq('user_id') 자리).
 * 읽음 표시라 쓰기 레이트 리밋은 세지 않는다.
 */

/** 멘션 하나 읽음(이미 읽었으면 그대로) */
export async function markMentionRead(input: unknown): Promise<ActionResult<{ updated: number }>> {
  const { user } = await requireWorkStaff()
  const parsed = messageIdSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    return ok({ updated: await markMentionReadRow(user.id, parsed.data.messageId) })
  } catch (e) {
    return dbFailure('markMentionRead', e)
  }
}

/** 읽지 않은 멘션 모두 읽음 */
export async function markAllMentionsRead(): Promise<ActionResult<{ updated: number }>> {
  const { user } = await requireWorkStaff()
  try {
    return ok({ updated: await markAllMentionsReadRows(user.id) })
  } catch (e) {
    return dbFailure('markAllMentionsRead', e)
  }
}

/** 북마크 해제(토글이 아니라 지우기만 — 두 번 눌러도 다시 생기지 않는다) */
export async function removeBookmark(input: unknown): Promise<ActionResult<{ removed: boolean }>> {
  const { user } = await requireWorkStaff()
  const parsed = messageIdSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    return ok({ removed: await removeBookmarkRow(user.id, parsed.data.messageId) })
  } catch (e) {
    return dbFailure('removeBookmark', e)
  }
}

/** 활동(스레드 답글·반응) 확인 시각을 지금으로 — 알림함을 열면 호출한다. 시각은 서버가 정한다 */
export async function markActivitySeen(): Promise<ActionResult<{ seen: true }>> {
  const { user } = await requireWorkStaff()
  try {
    await markActivitySeenRow(user.id)
    return ok({ seen: true })
  } catch (e) {
    return dbFailure('markActivitySeen', e)
  }
}
