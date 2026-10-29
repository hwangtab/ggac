import type { MarketDealType } from '@/constants/market'

type Translate = (key: string, values?: Record<string, string | number>) => string

/** 목록·상세 공통 가격 표기. 나눔은 "나눔", '삽니다'에 희망가가 없으면 "가격 협의". */
export function formatMarketPrice(
  t: Translate,
  locale: string,
  listing: { deal_type: MarketDealType; price: number | null }
): string {
  if (listing.deal_type === 'free') return t('price.free')
  if (listing.price === null || listing.price === undefined) return t('price.negotiable')
  return t('price.won', {
    price: listing.price.toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR'),
  })
}
