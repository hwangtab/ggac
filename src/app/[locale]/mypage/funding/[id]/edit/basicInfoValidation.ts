/**
 * 기본 정보 탭이 쓰는 순수 변환 함수. 화면(hooks·JSX)과 분리해 둔 이유는
 * 이 파일만 `node --test`로 곧장 검증할 수 있게 하기 위해서다.
 *
 * 목표 금액 입력 규칙은 개설 화면(`../../new/page.tsx`)과 같다 — 입력 중엔
 * 숫자를 깎지 않고 콤마만 붙이고, 정수 변환·상한 확인은 저장 시점에 한다.
 */

/** 사용자가 입력한 원문에서 숫자만 남기고, 화면에 보일 콤마 문자열로 바꾼다. */
export function formatGoalAmountDisplay(rawInput: string): string {
  const digits = rawInput.replace(/[^0-9]/g, '')
  return digits === '' ? '' : Number(digits).toLocaleString('ko-KR')
}

/** 콤마 섞인 표시 문자열을 저장용 정수로 바꾼다. 1 미만이면 null. */
export function parseGoalAmountDisplay(display: string): number | null {
  const digits = display.replace(/[^0-9]/g, '')
  if (digits === '') return null
  const n = Number(digits)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * ISO 날짜/시각 문자열을 `<input type="date">`가 받는 `YYYY-MM-DD`로 줄인다.
 * 값이 없거나 파싱할 수 없으면 빈 문자열이다(제어 컴포넌트가 undefined를
 * 받으면 안 되므로).
 */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}
