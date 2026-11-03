/**
 * 메시지 영역 날짜 표기(브리프 §5). 일시·날짜 규칙의 정본은 `@/lib/format/datetime`(docs/13 §9 s) —
 * 여기서는 그 규칙을 부르고, 메시지 타임라인 전용(시계·날짜 구분선·전체 시각)만 더 가진다.
 */
import { formatDateTime, seoulParts } from '@work/lib/format/datetime'

/** 서울 기준 날짜 키 'YYYY-MM-DD' (날짜 구분선 묶음용) */
export function seoulDayKey(iso: string | Date): string {
  const p = seoulParts(typeof iso === 'string' ? new Date(iso) : iso)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** 메시지 시각 — `formatDateTime` 과 같다(오늘 HH:mm / 올해 M월 d일 HH:mm / 다른 해 YYYY년 …) */
export function formatMessageTime(iso: string, now: Date = new Date()): string {
  return formatDateTime(iso, now)
}

/** 시:분만 */
export function formatClock(iso: string): string {
  const p = seoulParts(new Date(iso))
  return `${p.hour}:${p.minute}`
}

/** 날짜 구분선 문구: 오늘 / 어제 / M월 d일 (요일) */
export function formatDayDivider(dayKey: string, now: Date = new Date()): string {
  const today = seoulDayKey(now)
  const yesterday = seoulDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  if (dayKey === today) return '오늘'
  if (dayKey === yesterday) return '어제'
  const [y, m, d] = dayKey.split('-').map(Number)
  // 정오(UTC 03:00)로 잡으면 서울 날짜가 흔들리지 않는다
  const weekday = seoulParts(new Date(Date.UTC(y, m - 1, d, 3))).weekday
  const thisYear = Number(today.slice(0, 4))
  return `${y === thisYear ? '' : `${y}년 `}${m}월 ${d}일 (${weekday})`
}

/** 스크린리더·title 용 전체 시각 */
export function formatFullDateTime(iso: string): string {
  const p = seoulParts(new Date(iso))
  return `${p.year}년 ${p.month}월 ${p.day}일 (${p.weekday}) ${p.hour}:${p.minute}`
}
