/**
 * next-intl 로케일 → `Intl` 로케일 태그, 그리고 그 태그로 만드는 금액 숫자.
 *
 * 펀딩(`app/[locale]/funding/format.ts`)·예매(`app/[locale]/tickets/format.ts`)가
 * 글자 그대로 같은 함수를 각자 들고 있었고, 같은 매핑이 화면 곳곳에 인라인으로도
 * 있었다. 여기 하나로 모은다.
 *
 * 의존성을 두지 않는다 — `scripts/testing/fundingFormat.test.mjs`가 `funding/format.ts`를
 * `node --experimental-strip-types`로 직접 불러오므로, 이 파일이 `@/` 별칭이나
 * Next 전용 모듈을 물면 그 테스트가 `ERR_MODULE_NOT_FOUND`로 죽는다.
 */

/** next-intl locale → Intl 로케일 태그. */
export function intlLocale(locale: string): string {
  return locale === 'en' ? 'en-US' : 'ko-KR'
}

/** 금액의 숫자 부분만 만든다. 통화 표기는 화면의 번역 문자열이 붙인다. */
export function formatAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(Math.max(0, Math.trunc(value || 0)))
}
