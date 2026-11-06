// 상대경로 + 명시적 확장자로 임포트한다 — `scripts/testing/marketAuctionRules.test.mjs`가
// plain `node --experimental-strip-types --test`로 이 파일을 직접 import한다.
import type { AuctionRow, BidRow } from '../../db/queries/marketAuction.ts'

/**
 * 경매를 화면·API에 내보낼 모양. **회원 id를 싣지 않는다.**
 *
 * 입찰자·낙찰자는 조합원에게 활동명으로 보이면 충분하다. id(UUID)는 화면이 쓰지
 * 않는데 응답에만 실려, 다른 API에서 그 회원을 지목하는 열쇠로 쓰일 수 있었다.
 * 화면에 필요한 "이게 나인가"는 서버가 계산해 불리언으로 준다.
 */
export type PublicAuction = Omit<AuctionRow, 'current_bidder_id' | 'winner_id'> & {
  /** 지금 최고가가 내 입찰인가. */
  i_am_leading: boolean
  /** 내가 낙찰받았는가. */
  i_won: boolean
}

export type PublicBid = Omit<BidRow, 'bidder_id'> & { is_mine: boolean }

export function toPublicAuction(row: AuctionRow, viewerId: string): PublicAuction {
  const { current_bidder_id, winner_id, ...rest } = row
  return {
    ...rest,
    i_am_leading: current_bidder_id !== null && current_bidder_id === viewerId,
    i_won: winner_id !== null && winner_id === viewerId,
  }
}

export function toPublicBids(rows: BidRow[], viewerId: string): PublicBid[] {
  return rows.map(({ bidder_id, ...rest }) => ({ ...rest, is_mine: bidder_id === viewerId }))
}
