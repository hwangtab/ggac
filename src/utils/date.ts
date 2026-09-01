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

/**
 * 화면에 시각을 찍을 때 항상 붙여야 하는 타임존 옵션.
 *
 * **왜 필요한가.** Vercel 서버는 UTC로 돌고 브라우저는 방문자의 타임존으로 돈다.
 * `toLocaleDateString`/`toLocaleString`에 `timeZone`을 주지 않으면 그 둘이
 * 다른 값을 만들어 **SSR HTML과 하이드레이션 결과가 어긋난다** — 운영에서
 * 실제로 React #418이 떴고, 게시글 시각이 SSR `오전 09:15` / 브라우저
 * `오후 06:15`로 정확히 9시간 차이가 났다(2026-09-01 감사).
 *
 * 하이드레이션 밖에서도 문제다: 크롤러와 OG 캡처가 보는 HTML은 하이드레이션을
 * 거치지 않으므로 **틀린 시각이 그대로 굳는다.**
 *
 * 이 조합은 한국 조합원을 위한 사이트라는 전제에서 나온다 — 방문자의 기기
 * 타임존이 무엇이든 한국 시각을 보여준다.
 */
export const SEOUL_TIME_ZONE = { timeZone: 'Asia/Seoul' } as const
