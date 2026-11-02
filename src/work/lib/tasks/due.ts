/** 마감일 판정(Asia/Seoul 기준 날짜). 순수 함수 — 테스트하기 쉽게 today 를 인자로 받는다. */
import { formatDayKey } from '@work/lib/format/datetime'

const SEOUL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** 서울 기준 오늘 YYYY-MM-DD */
export function todaySeoul(now: Date = new Date()): string {
  return SEOUL.format(now)
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none'

/** 마감일까지 남은 일수(오늘=0, 지남=음수) */
export function daysUntil(dueOn: string, today: string): number {
  const a = Date.parse(`${dueOn}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  return Math.round((a - b) / 86_400_000)
}

/** 완료된 건 강조하지 않는다. 임박 = 내일·모레 */
export function dueState(dueOn: string | null, done: boolean, today: string): DueState {
  if (!dueOn || done) return 'none'
  const d = daysUntil(dueOn, today)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d <= 2) return 'soon'
  return 'later'
}

export function dueLabel(dueOn: string, today: string): string {
  const d = daysUntil(dueOn, today)
  if (d < 0) return `${-d}일 지남`
  if (d === 0) return '오늘'
  if (d === 1) return '내일'
  return formatDayKey(dueOn, new Date(`${today}T12:00:00+09:00`))
}
