/**
 * 다시 알림 시각 — 화면(고르기)과 라우트(판정)가 같이 쓴다. 시각은 **서울 기준**이다(서머타임이 없어 +09:00 고정).
 * 로컬 import가 없어야 한다 — `node --test` 타입 스트리핑 제약.
 *
 * 깨우기는 메일함 크론이 매시 15분에 한다 — 화면은 "최대 한 시간 늦을 수 있다"고 알린다.
 */

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** 가장 이른 다시 알림 — 지금으로부터 이만큼 뒤. 크론 주기보다 짧은 다시 알림은 의미가 없다. */
export const SNOOZE_MIN_MS = 30 * 60 * 1000
/** 가장 먼 다시 알림. */
export const SNOOZE_MAX_MS = 365 * DAY_MS

/** 서울 달력의 그날 `hour`시 정각(UTC 시각). `dayOffset`은 오늘로부터 며칠 뒤. */
function seoulAt(now: Date, dayOffset: number, hour: number): Date {
  const seoul = new Date(now.getTime() + SEOUL_OFFSET_MS)
  const utcMidnightOfSeoulDay = Date.UTC(
    seoul.getUTCFullYear(),
    seoul.getUTCMonth(),
    seoul.getUTCDate() + dayOffset
  )
  return new Date(utcMidnightOfSeoulDay + hour * HOUR_MS - SEOUL_OFFSET_MS)
}

export type SnoozePreset = { key: 'evening' | 'tomorrow' | 'next_monday'; label: string; at: Date }

/**
 * 고르기 칸 — 오늘 저녁 6시(아직 한 시간 넘게 남았을 때만), 내일 아침 9시, 다음 주 월요일 아침 9시.
 * "다음 주 월요일"은 오늘이 월요일이어도 7일 뒤다.
 */
export function snoozePresets(now: Date = new Date()): SnoozePreset[] {
  const presets: SnoozePreset[] = []
  const evening = seoulAt(now, 0, 18)
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push({ key: 'evening', label: '오늘 저녁 6시', at: evening })
  }
  presets.push({ key: 'tomorrow', label: '내일 아침 9시', at: seoulAt(now, 1, 9) })
  const seoulWeekday = new Date(now.getTime() + SEOUL_OFFSET_MS).getUTCDay() // 0=일 … 1=월
  const daysToMonday = (8 - seoulWeekday) % 7 || 7
  presets.push({
    key: 'next_monday',
    label: '다음 주 월요일 아침 9시',
    at: seoulAt(now, daysToMonday, 9),
  })
  return presets
}

/** 다시 알림 시각 판정 — 지금으로부터 30분 뒤 ~ 1년 안. 아니면 사유를 돌려준다. */
export function checkSnoozeUntil(
  until: Date,
  now: Date = new Date()
): { ok: true } | { ok: false; error: string } {
  const delta = until.getTime() - now.getTime()
  if (!Number.isFinite(delta)) return { ok: false, error: '시각이 올바르지 않습니다.' }
  if (delta < SNOOZE_MIN_MS)
    return { ok: false, error: '다시 알림은 30분 뒤부터 고를 수 있습니다.' }
  if (delta > SNOOZE_MAX_MS) return { ok: false, error: '다시 알림은 1년 안에서 골라 주세요.' }
  return { ok: true }
}
