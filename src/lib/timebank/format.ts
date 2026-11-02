// 상대경로 없는 순수 모듈이다 — plain `node --test`가 직접 import한다.
// CSV 행·거부 사유 문구는 Task 8에서 여기에 더한다.

/**
 * 분 → `'N시간 M분'`. 음수는 U+2212(−)를 붙인다. 0은 `'0분'`.
 */
export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '−' : ''
  const abs = Math.abs(Math.trunc(minutes))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (h === 0) return `${sign}${m}분`
  return m === 0 ? `${sign}${h}시간` : `${sign}${h}시간 ${m}분`
}
