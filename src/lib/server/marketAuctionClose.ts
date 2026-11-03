import { closeAuctionIfDue, listDueAuctionIds } from '@/db/queries/marketAuction'
import { getProfileDisplayName } from '@/db/queries/profiles'
import { notifyAuctionClosed } from '@/lib/server/marketAuctionNotify'
import { createLogger } from '@/utils/logger'

const log = createLogger('marketAuctionClose')

/**
 * 마감이 지난 경매를 닫고 알린다. **크론에 기대지 않는다** — 상세·목록·입찰
 * 요청이 들어올 때마다 그 자리에서 닫고, 10분 크론은 아무도 안 보는 경매를
 * 줍는 안전망이다. 닫기는 조건부 UPDATE라 몇 군데서 동시에 불러도 한 번만
 * 닫히고, 닫은 쪽만 알림을 보낸다.
 *
 * 실패는 삼킨다(로그만). 화면을 그리는 길에서 부르므로, 닫기에 실패했다고 상세
 * 화면이 죽으면 안 된다 — 다음 요청이나 크론이 다시 닫는다.
 */
export async function closeAuctionAndNotify(listingId: string, now = new Date()): Promise<boolean> {
  try {
    const closed = await closeAuctionIfDue(listingId, now)
    if (!closed) return false
    const winnerName = closed.winner_id
      ? await getProfileDisplayName(closed.winner_id).catch(() => null)
      : null
    await notifyAuctionClosed(closed, winnerName)
    return true
  } catch (error) {
    log.error('경매 닫기 실패', { listingId, error: (error as Error).message })
    return false
  }
}

/** 마감이 지난 경매 최대 `limit`건을 닫는다. 닫은 건수를 돌려준다. */
export async function sweepDueAuctions(limit: number, now = new Date()): Promise<number> {
  let ids: string[]
  try {
    ids = await listDueAuctionIds(now, limit)
  } catch (error) {
    log.error('마감 경매 조회 실패', { error: (error as Error).message })
    return 0
  }
  let closed = 0
  for (const id of ids) {
    if (await closeAuctionAndNotify(id, now)) closed++
  }
  return closed
}
