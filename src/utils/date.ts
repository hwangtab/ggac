/**
 * 한국 표준시(Asia/Seoul) 기준 오늘 날짜를 YYYY-MM-DD로 반환한다.
 * 공연 예정/지난 판정 기준 — UTC로 계산하면 KST가 9시간 앞서 있어 공연이
 * 끝난 뒤에도 최대 9시간 '예정'으로 잔류하는 오차가 생긴다.
 * en-CA 로케일이 YYYY-MM-DD 포맷을 내므로 이를 사용한다.
 */
export function todaySeoul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
