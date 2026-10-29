// 상대경로 + 명시적 확장자로 임포트한다(`src/lib/server/commentNotify.ts`와 같은
// 이유) — `scripts/testing/marketValidate.test.mjs`가 plain
// `node --experimental-strip-types --test`로 이 파일을 직접 import한다.
import {
  MARKET_CONDITIONS,
  MARKET_DEAL_TYPES,
  MARKET_DESCRIPTION_MAX,
  MARKET_IMAGES_MAX,
  MARKET_ITEM_CATEGORIES,
  MARKET_PRICE_MAX,
  MARKET_REGION_MAX,
  MARKET_STATUSES,
  MARKET_TITLE_MAX,
  MARKET_TRADE_METHODS,
  type MarketDealType,
  type MarketItemCategory,
  type MarketStatus,
} from '../../constants/market.ts'
import type { MarketListingFields } from '../../db/queries/market.ts'

/**
 * 성공이면 `error`가 `null`이다. 판별 키를 `ok: true | false`로 두지 않는 이유:
 * 이 저장소는 `strict: false`라 불리언 판별 유니온이 좁혀지지 않는다.
 */
export type ParseResult<T> = { value: T; error: null } | { value: null; error: string }

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function optionalOneOf<T extends string>(list: readonly T[], value: unknown): T | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null
  return oneOf(list, value) ?? 'invalid'
}

export function parseMarketStatus(value: unknown): MarketStatus | null {
  return oneOf(MARKET_STATUSES, value)
}

/**
 * 가격은 원 단위 정수다. 문자열 "15,000"도 받는다(입력칸이 콤마를 넣는다).
 * 소수·음수·상한 초과는 거절한다.
 */
function parsePrice(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null
  const raw = typeof value === 'string' ? value.replace(/[,\s]/g, '') : value
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isInteger(n) || n < 0 || n > MARKET_PRICE_MAX) return 'invalid'
  return n
}

/**
 * 사진 칸의 **모양**만 본다(https 주소 배열, 개수 상한, 중복 제거). 판매자
 * 본인이 올린 파일인지는 DB를 봐야 하므로 라우트가 업로드 원장으로 따로
 * 확인한다(`filterUploadsOwnedBy`).
 */
function parseImages(value: unknown): string[] | 'invalid' {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return 'invalid'
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return 'invalid'
    let url: URL
    try {
      url = new URL(item)
    } catch {
      return 'invalid'
    }
    if (url.protocol !== 'https:') return 'invalid'
    if (!out.includes(item)) out.push(item)
  }
  if (out.length > MARKET_IMAGES_MAX) return 'invalid'
  return out
}

/** 쓰기 본문(생성·전체 수정 공통) → 저장할 값. 메시지는 화면에 그대로 뜬다. */
export function parseMarketListingInput(
  body: Record<string, unknown>
): ParseResult<MarketListingFields> {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title.length < 2) return { value: null, error: '제목을 2자 이상 입력해 주세요.' }
  if (title.length > MARKET_TITLE_MAX) {
    return { value: null, error: `제목은 ${MARKET_TITLE_MAX}자를 넘을 수 없습니다.` }
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) return { value: null, error: '설명을 입력해 주세요.' }
  if (description.length > MARKET_DESCRIPTION_MAX) {
    return { value: null, error: `설명은 ${MARKET_DESCRIPTION_MAX}자를 넘을 수 없습니다.` }
  }

  const dealType = oneOf<MarketDealType>(MARKET_DEAL_TYPES, body.deal_type)
  if (!dealType) return { value: null, error: '거래 유형을 선택해 주세요.' }

  const itemCategory = oneOf<MarketItemCategory>(MARKET_ITEM_CATEGORIES, body.item_category)
  if (!itemCategory) return { value: null, error: '품목을 선택해 주세요.' }

  const parsedPrice = parsePrice(body.price)
  if (parsedPrice === 'invalid') {
    return { value: null, error: '가격은 0 이상의 정수(원)로 입력해 주세요.' }
  }
  let price: number | null
  if (dealType === 'free') {
    // 나눔은 가격이 없다. 입력칸에 뭐가 남아 있든 0으로 저장한다.
    price = 0
  } else if (dealType === 'sell') {
    if (parsedPrice === null || parsedPrice === 0) {
      return { value: null, error: '판매 가격을 입력해 주세요. 무료라면 나눔을 선택해 주세요.' }
    }
    price = parsedPrice
  } else {
    // 삽니다: 희망가는 비워 둘 수 있다.
    price = parsedPrice
  }

  const condition = optionalOneOf(MARKET_CONDITIONS, body.condition)
  if (condition === 'invalid') return { value: null, error: '상품 상태 값이 올바르지 않습니다.' }

  const tradeMethod = optionalOneOf(MARKET_TRADE_METHODS, body.trade_method)
  if (tradeMethod === 'invalid') return { value: null, error: '거래 방식 값이 올바르지 않습니다.' }

  const regionRaw = typeof body.region === 'string' ? body.region.trim() : ''
  if (regionRaw.length > MARKET_REGION_MAX) {
    return { value: null, error: `지역은 ${MARKET_REGION_MAX}자를 넘을 수 없습니다.` }
  }

  const images = parseImages(body.images)
  if (images === 'invalid') {
    return { value: null, error: `사진은 최대 ${MARKET_IMAGES_MAX}장까지 올릴 수 있습니다.` }
  }

  return {
    error: null,
    value: {
      title,
      description,
      deal_type: dealType,
      item_category: itemCategory,
      price,
      condition,
      trade_method: tradeMethod,
      region: regionRaw || null,
      images,
    },
  }
}

export interface MarketListQuery {
  status?: MarketStatus
  hideDone: boolean
  dealType?: MarketDealType
  itemCategory?: MarketItemCategory
  page: number
}

/** 목록 쿼리스트링. 모르는 값은 버린다(필터 없음으로 취급). */
export function parseMarketListQuery(params: URLSearchParams): MarketListQuery {
  const pageRaw = Number(params.get('page'))
  return {
    status: parseMarketStatus(params.get('status')) ?? undefined,
    hideDone: params.get('hideDone') === '1',
    dealType: oneOf(MARKET_DEAL_TYPES, params.get('deal')) ?? undefined,
    itemCategory: oneOf(MARKET_ITEM_CATEGORIES, params.get('item')) ?? undefined,
    page: Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 1000 ? pageRaw : 1,
  }
}
