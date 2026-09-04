/**
 * 예매 화면의 날짜·금액 포매팅.
 *
 * 서버와 클라이언트가 같은 문자열을 만들어야 하므로 **타임존을 고정**한다
 * (`SEOUL_TIME_ZONE`). 고정하지 않으면 SSR HTML과 하이드레이션 결과가 어긋난다.
 */

import { SEOUL_TIME_ZONE } from '@/utils/date'

/** next-intl locale → Intl 로케일 태그. */
export function intlLocale(locale: string): string {
  return locale === 'en' ? 'en-US' : 'ko-KR'
}

/** 회차 시각. 예) 9월 12일 (금) 오후 07:30 */
export function formatShowTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(intlLocale(locale), {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...SEOUL_TIME_ZONE,
  })
}

/** 금액의 숫자 부분만 만든다. 통화 표기는 번역 문자열(`priceFormat`)이 붙인다. */
export function formatAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(Math.max(0, Math.trunc(value || 0)))
}
