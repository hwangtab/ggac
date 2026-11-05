/**
 * 메일함 기간 검색의 날짜 해석. 로컬 import가 없어야 한다 — `node --test` 타입 스트리핑 제약.
 */

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * `YYYY-MM-DD`를 **서울 기준 그날 0시**로 읽는다. 화면의 날짜 입력은 사람이 보는 날짜이므로 UTC로 읽으면
 * 오전 9시 전에 온 메일이 하루 어긋난다. 서울은 서머타임이 없어 +09:00 고정이다. 형식이 아니면 null.
 */
export function parseSeoulDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return null
  // `2026-02-31`은 Date가 3월로 넘겨 버린다 — 되돌려 맞춰 보고 다르면 거부한다.
  const roundTrip = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return roundTrip === value ? date : null
}
