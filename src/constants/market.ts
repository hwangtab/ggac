/**
 * 조합원 장터 상수.
 *
 * DB에는 CHECK 제약을 두지 않는다(펀딩과 같은 방식) — 허용값의 정본은 이
 * 파일이고, 쓰기 라우트가 `parseMarketListingInput`(`src/lib/market/validate.ts`)
 * 으로 거른다. 저장값은 영문 식별자, 화면 이름은 `messages/*.json`의 `market`
 * 네임스페이스에 있다.
 */

/** 팝니다 · 삽니다 · 나눔 · 경매 */
export const MARKET_DEAL_TYPES = ['sell', 'buy', 'free', 'auction'] as const
export type MarketDealType = (typeof MARKET_DEAL_TYPES)[number]

export const MARKET_ITEM_CATEGORIES = ['instrument', 'audio', 'stage', 'books', 'etc'] as const
export type MarketItemCategory = (typeof MARKET_ITEM_CATEGORIES)[number]

/** 판매중 · 예약중 · 거래완료 */
export const MARKET_STATUSES = ['open', 'reserved', 'done'] as const
export type MarketStatus = (typeof MARKET_STATUSES)[number]

export const MARKET_CONDITIONS = ['new', 'good', 'used', 'parts'] as const
export type MarketCondition = (typeof MARKET_CONDITIONS)[number]

export const MARKET_TRADE_METHODS = ['direct', 'delivery', 'both'] as const
export type MarketTradeMethod = (typeof MARKET_TRADE_METHODS)[number]

export const MARKET_TITLE_MAX = 80
export const MARKET_DESCRIPTION_MAX = 3000
export const MARKET_REGION_MAX = 40
export const MARKET_COMMENT_MAX = 1000
export const MARKET_IMAGES_MAX = 6
/** 1억 원. 오타(0 하나 더)를 막는 상한이지 정책이 아니다. */
export const MARKET_PRICE_MAX = 100_000_000
export const MARKET_PAGE_SIZE = 24

export const MARKET_STATUS_STYLES: Record<MarketStatus, string> = {
  open: 'bg-green-100 text-green-800',
  reserved: 'bg-amber-100 text-amber-800',
  done: 'bg-gray-200 text-gray-600',
}

/**
 * 경매 (2026-10-29). 판매자가 여는 오름차순 공개 경매 하나뿐이다 — 역경매·
 * 자동입찰은 없다. 조합은 결제하지 않는다: 낙찰은 "그 가격으로 직거래할
 * 우선권"이고, 그 뒤는 일반 매물처럼 댓글로 이어진다.
 */
export const MARKET_AUCTION_STATES = ['live', 'ended', 'no_bids', 'canceled'] as const
export type MarketAuctionState = (typeof MARKET_AUCTION_STATES)[number]

/** 고를 수 있는 경매 기간(일). */
export const MARKET_AUCTION_DURATIONS = [1, 3, 5, 7] as const
export type MarketAuctionDuration = (typeof MARKET_AUCTION_DURATIONS)[number]

/** 마감 이 시간 안에 입찰이 들어오면 마감을 이만큼 뒤로 민다(막판 낚아채기 방지). */
export const MARKET_AUCTION_EXTEND_MS = 2 * 60 * 1000

export const MARKET_AUCTION_MIN_INCREMENT = 100
export const MARKET_AUCTION_MAX_INCREMENT = 1_000_000
/** 시작가 하한. 0원 경매는 나눔과 구분되지 않는다. */
export const MARKET_AUCTION_MIN_START = 1_000
