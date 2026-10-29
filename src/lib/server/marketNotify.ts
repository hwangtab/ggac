// 상대경로 + 명시적 확장자로 임포트한다(`commentNotify.ts`와 같은 이유).
import { createBulkNotifications } from '../../db/queries/notifications.ts'
import { createLogger } from '../../utils/logger.ts'

const log = createLogger('marketNotify')

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export type NotifyMarketCommentInput = {
  listingId: string
  listingTitle: string
  sellerId: string
  commentId: string
  actorId: string
  /** 이 댓글을 쓰기 **전에** 댓글을 남긴 사람들(삭제분 제외, 중복 없음). */
  priorCommenterIds: string[]
}

/**
 * 받는 사람을 고른다. 부수효과가 없어 테스트로 고정할 수 있게 떼어 냈다.
 *
 * - 문의자가 쓰면 **판매자에게만** 간다. 같은 글에 문의한 다른 조합원에게
 *   보내면 남의 흥정이 내 알림함을 채운다.
 * - 판매자가 쓰면 **그 글에 문의한 사람 전부**에게 간다. 판매자 답글은 대개
 *   "예약됐어요"·"아직 있어요"처럼 모두에게 하는 말이다.
 */
export function pickMarketCommentRecipients(
  input: Pick<NotifyMarketCommentInput, 'sellerId' | 'actorId' | 'priorCommenterIds'>
): string[] {
  if (input.actorId !== input.sellerId) return [input.sellerId]
  return [...new Set(input.priorCommenterIds)].filter(id => id !== input.sellerId)
}

/**
 * 장터 댓글 알림. 실패는 로깅만 하고 댓글 작성을 막지 않는다 — 호출부는 이
 * 함수가 throw하지 않는다고 가정하고 그냥 `await`한다(`notifyNewComment`와
 * 같은 계약).
 */
export async function notifyMarketComment(input: NotifyMarketCommentInput): Promise<void> {
  const recipients = pickMarketCommentRecipients(input)
  if (recipients.length === 0) return

  const fromSeller = input.actorId === input.sellerId
  try {
    await createBulkNotifications({
      user_ids: recipients,
      type: 'market_comment',
      title: fromSeller ? '판매자가 답글을 남겼습니다' : '장터 글에 문의가 왔습니다',
      message: `${input.listingTitle}에 새 댓글이 달렸습니다.`,
      data: { listing_id: input.listingId, comment_id: input.commentId },
      related_post_id: input.listingId,
      related_user_id: input.actorId,
      expires_at: new Date(Date.now() + THIRTY_DAYS_MS).toISOString(),
    })
  } catch (e) {
    log.error('장터 댓글 알림 발송 실패', {
      listingId: input.listingId,
      commentId: input.commentId,
      error: (e as Error).message,
    })
  }
}
