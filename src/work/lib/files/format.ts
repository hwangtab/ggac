/** `YYYY-MM-DD` 가 달력에 있는 날짜인가(2026-13-01·2026-02-30 같은 값은 false) */
export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** `YYYY-MM-DD`(KST 달력 날짜) → 그날 00:00 KST 의 ISO */
export function kstDayStart(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toISOString()
}

/** `YYYY-MM-DD`(KST) → 다음날 00:00 KST 의 ISO(배타적 상한) */
export function kstDayEnd(date: string): string {
  return new Date(new Date(`${date}T00:00:00+09:00`).getTime() + 24 * 3600 * 1000).toISOString()
}
