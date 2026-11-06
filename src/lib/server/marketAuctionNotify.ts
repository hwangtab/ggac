// 상대경로 + 명시적 확장자로 임포트한다(`commentNotify.ts`와 같은 이유).
import { createBulkNotifications, createNotification } from '../../db/queries/notifications.ts'
import type { ClosedAuction } from '../../db/queries/marketAuction.ts'
import { createLogger } from '../../utils/logger.ts'

const log = createLogger('marketAuctionNotify')

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function won(amount: number | null): string {
  return amount === null ? '' : `${amount.toLocaleString('ko-KR')}원`
}

/**
 * 경매 알림이 만들 문장. 부수효과가 없어 테스트로 고정할 수 있게 떼어 냈다.
 * 낙찰이면 낙찰자·판매자 두 통, 유찰이면 판매자 한 통이다.
 */
export function buildAuctionClosedNotices(
  closed: ClosedAuction,
  winnerName: string | null
): Array<{
  user_id: string
  type: 'market_auction_won' | 'market_auction_ended'
  title: string
  message: string
}> {
  if (closed.state === 'no_bids' || !closed.winner_id) {
    return [
      {
        user_id: closed.seller_id,
        type: 'market_auction_ended',
        title: '경매가 유찰되었습니다',
        message: `${closed.title} 경매가 입찰 없이 끝났습니다.`,
      },
    ]
  }
  return [
    {
      user_id: closed.winner_id,
      type: 'market_auction_won',
      title: '경매에 낙찰되었습니다',
      message: `${closed.title}을(를) ${won(closed.winning_price)}에 낙찰받았습니다. 판매자와 댓글로 거래를 이어가세요.`,
    },
    {
      user_id: closed.seller_id,
      type: 'market_auction_ended',
      title: '경매가 낙찰되었습니다',
      message: `${closed.title}이(가) ${winnerName ?? '조합원'} 님에게 ${won(closed.winning_price)}에 낙찰되었습니다.`,
    },
  ]
}

/**
 * 실패는 로깅만 한다 — 호출부는 이 함수들이 throw하지 않는다고 가정하고
 * 그냥 `await`한다(`notifyNewComment`와 같은 계약).
 */
export async function notifyAuctionClosed(
  closed: ClosedAuction,
  winnerName: string | null
): Promise<void> {
  for (const notice of buildAuctionClosedNotices(closed, winnerName)) {
    try {
      await createNotification({
        ...notice,
        data: { listing_id: closed.listing_id },
        related_post_id: closed.listing_id,
        expires_at: new Date(Date.now() + THIRTY_DAYS_MS).toISOString(),
      })
    } catch (e) {
      log.error('경매 종료 알림 발송 실패', {
        listingId: closed.listing_id,
        userId: notice.user_id,
        error: (e as Error).message,
      })
    }
  }
}

export async function notifyOutbid(input: {
  listingId: string
  listingTitle: string
  outbidUserId: string
  newPrice: number
  actorId: string
}): Promise<void> {
  try {
    await createNotification({
      user_id: input.outbidUserId,
      type: 'market_outbid',
      title: '더 높은 입찰이 들어왔습니다',
      message: `${input.listingTitle} 현재가가 ${won(input.newPrice)}이 되었습니다.`,
      data: { listing_id: input.listingId },
      related_post_id: input.listingId,
      related_user_id: input.actorId,
      expires_at: new Date(Date.now() + THIRTY_DAYS_MS).toISOString(),
    })
  } catch (e) {
    log.error('입찰 추월 알림 발송 실패', {
      listingId: input.listingId,
      error: (e as Error).message,
    })
  }
}

/** 판매자에게 첫 입찰을 알린다. 입찰마다 보내지 않는다 — 막판 경쟁이면 수십 통이다. */
export async function notifyFirstBid(input: {
  listingId: string
  listingTitle: string
  sellerId: string
  amount: number
  actorId: string
}): Promise<void> {
  try {
    await createNotification({
      user_id: input.sellerId,
      type: 'market_bid_received',
      title: '경매에 첫 입찰이 들어왔습니다',
      message: `${input.listingTitle}에 ${won(input.amount)} 입찰이 들어왔습니다. 이제 경매를 고치거나 내릴 수 없습니다.`,
      data: { listing_id: input.listingId },
      related_post_id: input.listingId,
      related_user_id: input.actorId,
      expires_at: new Date(Date.now() + THIRTY_DAYS_MS).toISOString(),
    })
  } catch (e) {
    log.error('첫 입찰 알림 발송 실패', { listingId: input.listingId, error: (e as Error).message })
  }
}

/**
 * 사무국이 입찰이 있는 진행 중 경매를 내렸을 때 입찰자에게 알린다. 알리지 않으면
 * 입찰자에게는 경매가 조용히 사라진다(상세가 404가 된다).
 */
export async function notifyAuctionCanceled(input: {
  listingId: string
  listingTitle: string
  bidderIds: string[]
}): Promise<void> {
  if (input.bidderIds.length === 0) return
  try {
    await createBulkNotifications({
      user_ids: input.bidderIds,
      type: 'market_auction_canceled',
      title: '입찰한 경매가 취소되었습니다',
      message: `${input.listingTitle} 경매를 사무국이 내렸습니다. 입찰은 효력이 없습니다.`,
      data: { listing_id: input.listingId },
      related_post_id: input.listingId,
      expires_at: new Date(Date.now() + THIRTY_DAYS_MS).toISOString(),
    })
  } catch (e) {
    log.error('경매 취소 알림 발송 실패', {
      listingId: input.listingId,
      error: (e as Error).message,
    })
  }
}
