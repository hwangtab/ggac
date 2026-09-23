/**
 * 펀딩 약관 문서의 시행일. **문자열은 여기 하나뿐이다.**
 *
 * 약관 화면(`src/app/[locale]/funding/terms/page.tsx`)이 시행일로 찍는 값이
 * 곧 동의 기록에 남는 값이어야 한다. 전에는 화면과 두 라우트가 각자 날짜를
 * 들고 있어, 저장된 동의가 아무도 본 적 없는 판본을 가리켰다.
 *
 * 문서가 바뀌면 이 상수만 고친다 — 화면의 시행일, 개설자 동의
 * (`POST /api/mypage/funding/campaigns`), 후원 동의
 * (`POST /api/funding/pledges/prepare`)가 같이 따라온다.
 *
 * 상수를 약관 페이지 파일이 아니라 여기 두는 이유는 두 API 라우트가 읽어야
 * 하기 때문이다 — 라우트가 페이지 모듈을 import하면 React 컴포넌트가 API
 * 번들에 딸려 들어온다.
 */
export const FUNDING_TERMS_REVISION = '2026-09-23'
