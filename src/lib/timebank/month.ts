// 상대경로 없는 순수 모듈이다 — plain `node --test`가 직접 import한다.
/**
 * 타임뱅크의 "월"은 KST다(스펙 §9.5). 월 상한·내역·집계가 모두 이 두 함수를
 * 쓴다. KST는 일광절약시간이 없으므로 고정 +9시간으로 계산한다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

/** 시각 → KST 기준 `'YYYY-MM'`. */
export function kstMonthKey(at: Date): string {
  const kst = new Date(at.getTime() + KST_OFFSET_MS)
  const y = kst.getUTCFullYear()
  const m = kst.getUTCMonth() + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

/**
 * `'YYYY-MM'` → 그 KST 월의 `[startMs, endMs)`(UTC 밀리초). 형식이 틀리면
 * `RangeError`를 던진다 — 호출자가 입력을 검증하지 않았다는 프로그래밍 오류다.
 */
export function kstMonthRange(key: string): { startMs: number; endMs: number } {
  const match = MONTH_KEY.exec(key)
  if (!match) throw new RangeError(`잘못된 월 키: ${key}`)
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  // Date.UTC는 monthIndex 12를 다음 해 1월로 넘겨 준다.
  return {
    startMs: Date.UTC(year, monthIndex, 1) - KST_OFFSET_MS,
    endMs: Date.UTC(year, monthIndex + 1, 1) - KST_OFFSET_MS,
  }
}
