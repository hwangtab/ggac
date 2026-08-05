/**
 * 한국 표준시(Asia/Seoul) 기준 오늘 날짜를 YYYY-MM-DD로 반환한다.
 * 공연 예정/지난 판정 기준 — UTC로 계산하면 KST가 9시간 앞서 있어 공연이
 * 끝난 뒤에도 최대 9시간 '예정'으로 잔류하는 오차가 생긴다.
 * en-CA 로케일이 YYYY-MM-DD 포맷을 내므로 이를 사용한다.
 */
export function todaySeoul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/**
 * 'YYYY-MM-DD' 같은 날짜-only 문자열을 로컬 타임존 기준 Date로 파싱한다.
 * new Date('2026-09-30')은 UTC 자정으로 해석돼, UTC보다 뒤진 지역(미주 등)에서
 * 날짜가 하루 일찍 표시되는 오차가 난다. 날짜-only는 로컬 자정으로 파싱해 이를 막는다.
 * 시각이 포함된 문자열은 그대로 파싱한다.
 */
export function parseLocalDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00') : new Date(value)
}
