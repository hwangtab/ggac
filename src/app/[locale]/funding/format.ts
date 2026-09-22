/**
 * 펀딩 화면의 금액·기간·달성률 포매팅.
 *
 * 서버와 클라이언트가 같은 문자열을 만들어야 하므로 타임존을 고정한다
 * (`SEOUL_TIME_ZONE`) — 고정하지 않으면 SSR HTML과 하이드레이션이 어긋난다.
 * 예매 화면(`../tickets/format.ts`)과 같은 이유·같은 방식이다.
 */

export function intlLocale(locale: string): string {
  return locale === 'en' ? 'en-US' : 'ko-KR'
}

/** 금액의 숫자 부분만. 통화 표기는 번역 문자열(`amountFormat`)이 붙인다. */
export function formatAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(Math.max(0, Math.trunc(value || 0)))
}

/**
 * 달성률(%). 내림한 정수다 — 99.9%를 100%로 올리면 목표를 넘긴 것처럼 읽힌다.
 * 목표가 0 이하인 캠페인은 만들 수 없지만(입력 검증), 화면이 0으로 나누지 않도록 막는다.
 */
export function computePercent(raised: number, goal: number): number {
  const r = Math.max(0, Math.trunc(raised || 0))
  const g = Math.trunc(goal || 0)
  if (g <= 0) return 0
  return Math.floor((r / g) * 100)
}

/**
 * 남은 일수. 달력 날짜의 차이다 — 텀블벅이 "21일 남음"으로 적는 것과 같은 셈법이다.
 * **마감 당일은 0이고, 화면은 그때 "0일"이 아니라 "오늘 마감"으로 적는다**(`progress.lastDay`).
 * 이미 지났으면 `null`이고, 화면은 남은 기간 자리를 통째로 비운다.
 *
 * `end_at`은 표시 전용이고 접수 개폐는 `status`가 정한다(설계 §1). 날짜가 지났는데
 * 아직 열려 있는 캠페인에 "0일 남음"을 보이면 닫힌 것처럼 보이므로 그 경우도 null이다.
 */
export function computeDaysLeft(
  endAt: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!endAt) return null
  const end = new Date(endAt)
  if (Number.isNaN(end.getTime())) return null
  const KST = 9 * 60 * 60 * 1000
  const DAY = 24 * 60 * 60 * 1000
  // KST 달력 날짜로 바꿔 자정 기준으로 뺀다. 시:분을 그대로 빼면 같은 날인데도
  // 시각에 따라 0일과 1일이 갈린다.
  const endDay = Math.floor((end.getTime() + KST) / DAY)
  const nowDay = Math.floor((now.getTime() + KST) / DAY)
  const diff = endDay - nowDay
  return diff < 0 ? null : diff
}

/** 후원이 하나도 없으면 0원·0%·0건 대신 목표 금액만 적는다. */
export function hasBackers(progress: { backer_count: number }): boolean {
  return Number(progress?.backer_count ?? 0) > 0
}
