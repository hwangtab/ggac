/**
 * 날짜·시각 표기 단일 모듈(docs/13 §9 s). 사람이 보는 화면 표기는 전부 여기를 거친다.
 *
 * 규칙(Asia/Seoul):
 * - 일시(`formatDateTime`): 오늘 `HH:mm` / 올해 `M월 d일 HH:mm` / 다른 해 `YYYY년 M월 d일 HH:mm`
 * - 날짜만(`formatDay`·`formatDayKey`): 올해 `M월 d일` / 다른 해 `YYYY년 M월 d일`
 *   (가입일·마감일처럼 시각이 의미 없는 값)
 *
 * 순수 함수라 서버·클라이언트 어디서나 쓴다. `<input type=date>` 값·`YYYY-MM-DD` 키·CSV/엑셀 내보내기·
 * 서버 로그용 형식은 이 모듈의 대상이 아니다.
 */
const TZ = 'Asia/Seoul'

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
})

const WEEKDAY_KO: Record<string, string> = {
  Sun: '일',
  Mon: '월',
  Tue: '화',
  Wed: '수',
  Thu: '목',
  Fri: '금',
  Sat: '토',
}

export type SeoulParts = {
  year: number
  month: number
  day: number
  hour: string
  minute: string
  weekday: string
}

/** 서울 기준 달력 부품(연·월·일·시·분·요일) */
export function seoulParts(date: Date): SeoulParts {
  const map: Record<string, string> = {}
  for (const p of partsFormatter.formatToParts(date)) map[p.type] = p.value
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour === '24' ? '00' : map.hour,
    minute: map.minute,
    weekday: WEEKDAY_KO[map.weekday] ?? '',
  }
}

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value
}

/** `M월 d일` — 올해가 아니면 앞에 `YYYY년 ` */
function monthDay(year: number, month: number, day: number, nowYear: number): string {
  const md = `${month}월 ${day}일`
  return year === nowYear ? md : `${year}년 ${md}`
}

/** 일시: 오늘 `HH:mm` / 올해 `M월 d일 HH:mm` / 다른 해 `YYYY년 M월 d일 HH:mm` */
export function formatDateTime(value: string | Date, now: Date = new Date()): string {
  const p = seoulParts(toDate(value))
  const n = seoulParts(now)
  const hm = `${p.hour}:${p.minute}`
  if (p.year === n.year && p.month === n.month && p.day === n.day) return hm
  return `${monthDay(p.year, p.month, p.day, n.year)} ${hm}`
}

/** 날짜만(시각 순간 → 서울 달력 날짜): 올해 `M월 d일` / 다른 해 `YYYY년 M월 d일` */
export function formatDay(value: string | Date, now: Date = new Date()): string {
  const p = seoulParts(toDate(value))
  return monthDay(p.year, p.month, p.day, seoulParts(now).year)
}

/** 날짜만(달력 날짜 키 `YYYY-MM-DD` — 마감일·발의일 등 이미 날짜인 값). 시간대 변환 없이 그대로 읽는다. */
export function formatDayKey(key: string, now: Date = new Date()): string {
  const [y, m, d] = key.split('-').map(Number)
  return monthDay(y, m, d, seoulParts(now).year)
}
