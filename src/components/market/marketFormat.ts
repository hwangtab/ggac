import type { MarketDealType } from '@/constants/market'
import type { MarketListingAuctionSummary } from '@/db/queries/market'

type Translate = (key: string, values?: Record<string, string | number>) => string

function won(t: Translate, locale: string, amount: number): string {
  return t('price.won', { price: amount.toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR') })
}

/**
 * 목록·상세 공통 가격 표기. 나눔은 "나눔", '삽니다'에 희망가가 없으면 "가격 협의".
 * 경매는 입찰이 있으면 "현재가", 없으면 "시작가", 끝났으면 "낙찰가"를 붙인다.
 */
export function formatMarketPrice(
  t: Translate,
  locale: string,
  listing: {
    deal_type: MarketDealType
    price: number | null
    auction?: MarketListingAuctionSummary | null
  }
): string {
  if (listing.deal_type === 'auction' && listing.auction) {
    const { auction } = listing
    if (auction.current_price === null) {
      return `${t('auction.startPrice')} ${won(t, locale, auction.start_price)}`
    }
    const label = auction.state === 'ended' ? t('auction.winningPrice') : t('auction.currentPrice')
    return `${label} ${won(t, locale, auction.current_price)}`
  }
  if (listing.deal_type === 'free') return t('price.free')
  if (listing.price === null || listing.price === undefined) return t('price.negotiable')
  return won(t, locale, listing.price)
}

/**
 * 남은 시간 한 줄. 서버가 렌더하는 목록 카드용이라 초 단위는 쓰지 않는다
 * (상세 화면의 카운트다운은 `AuctionPanel`이 따로 돈다).
 */
export function formatAuctionRemaining(t: Translate, endsAt: string, now = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now
  if (ms <= 0) return t('auction.closing')
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return t('auction.leftMinutes', { count: Math.max(1, minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('auction.leftHours', { count: hours })
  return t('auction.leftDays', { count: Math.floor(hours / 24) })
}
