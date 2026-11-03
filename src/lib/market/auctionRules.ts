// 상대경로 + 명시적 확장자로 임포트한다 — `scripts/testing/marketAuctionRules.test.mjs`가
// plain `node --experimental-strip-types --test`로 이 파일을 직접 import한다.
import type { MarketAuctionState, MarketDealType } from '../../constants/market.ts'

/**
 * 경매 매물에 대한 쓰기 규칙. **권한이 아니라 경매의 약속이다** — 판매자 본인이
 * 맞아도, 입찰한 사람이 믿고 부른 조건을 뒤에서 바꾸지 못하게 한다. 권한(누가
 * 판매자인가·관리자인가)은 라우트가 먼저 판정하고, 통과한 요청에 이 규칙을 건다.
 *
 * 막히면 화면에 그대로 뜰 문장을, 통과면 `null`을 돌려준다.
 */
export interface AuctionListingFacts {
  deal_type: MarketDealType
  auction_state: MarketAuctionState | null
  auction_bid_count: number
}

/** 제목·설명·사진 수정. 경매는 입찰이 하나도 없고 진행 중일 때만 고칠 수 있다. */
export function blockEdit(facts: AuctionListingFacts, nextDealType: MarketDealType): string | null {
  const wasAuction = facts.deal_type === 'auction'
  if (wasAuction !== (nextDealType === 'auction')) {
    return '경매와 일반 거래 사이에서는 거래 유형을 바꿀 수 없습니다. 매물을 새로 올려 주세요.'
  }
  if (!wasAuction) return null
  if (facts.auction_state !== 'live') return '끝난 경매는 수정할 수 없습니다.'
  if (facts.auction_bid_count > 0) return '입찰이 들어온 경매는 수정할 수 없습니다.'
  return null
}

/** 거래 상태(판매중·예약중·거래완료). 경매가 진행 중일 때는 경매가 상태를 정한다. */
export function blockStatusChange(facts: AuctionListingFacts): string | null {
  if (facts.deal_type === 'auction' && facts.auction_state === 'live') {
    return '경매가 진행 중일 때는 거래 상태를 바꿀 수 없습니다.'
  }
  return null
}

/**
 * 판매자 본인의 삭제. 입찰이 들어온 진행 중 경매는 판매자가 내리지 못한다 —
 * 관리자에게만 열려 있다(`isAdmin`이면 이 규칙을 건너뛴다).
 */
export function blockSellerDelete(facts: AuctionListingFacts, isAdmin: boolean): string | null {
  if (isAdmin) return null
  if (
    facts.deal_type === 'auction' &&
    facts.auction_state === 'live' &&
    facts.auction_bid_count > 0
  ) {
    return '입찰이 들어온 경매는 내릴 수 없습니다. 사무국(contact@ggac.kr)에 요청해 주세요.'
  }
  return null
}
