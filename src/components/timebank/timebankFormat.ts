import type { TimebankListingKind, TimebankListingStatus } from '@/constants/timebank'

type Translate = (key: string, values?: Record<string, string | number>) => string

/** 게시판 목록 한 쪽의 글 수. `GET /api/timebank/listings`의 `PAGE_SIZE`와 같다. */
export const TIMEBANK_PAGE_SIZE = 20

/** 예상 시간 선택지(분) — 30분 단위 30~480(`parseListingInput`과 같은 범위). */
export const TIMEBANK_ESTIMATE_OPTIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30)

export const TIMEBANK_STATUS_STYLES: Record<TimebankListingStatus, string> = {
  open: 'bg-green-100 text-green-800',
  closed: 'bg-gray-200 text-gray-600',
}

export const TIMEBANK_KIND_STYLES: Record<TimebankListingKind, string> = {
  offer: 'bg-primary-50 text-primary-700',
  request: 'bg-amber-50 text-amber-800',
  coop_task: 'bg-violet-50 text-violet-700',
}

/**
 * 분 → "N시간 M분"(로케일별). `timebank` 네임스페이스의 `duration.*`를 쓴다.
 * `null`은 "미정". `src/lib/timebank/format.ts`의 `formatMinutes`는 한국어 고정이라
 * 화면에서는 이것을 쓴다.
 */
export function formatTimebankMinutes(t: Translate, minutes: number | null): string {
  if (minutes === null || minutes === undefined) return t('duration.undecided')
  const abs = Math.abs(Math.trunc(minutes))
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  const sign = minutes < 0 ? '−' : ''
  if (hours === 0) return sign + t('duration.minutes', { minutes: rest })
  if (rest === 0) return sign + t('duration.hours', { hours })
  return sign + t('duration.hoursMinutes', { hours, minutes: rest })
}
