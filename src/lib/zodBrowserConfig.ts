/**
 * 브라우저에서 zod 의 eval 탐지를 끄는 인라인 스크립트(`app/[locale]/layout.tsx`의 `<head>`가 넣는다).
 *
 * zod 4 는 **객체 스키마를 만들 때** `Function("")`을 한 번 불러 eval 이 되는지 본다(되면 빠른 경로). 우리 운영 CSP 는
 * `script-src`에 `unsafe-eval`이 없어 그 탐지가 막히고, 브라우저가 CSP 위반 보고를 보낸다 — `/api/security/csp-report`가
 * 그것을 "CRITICAL SECURITY EVENT CSP_VIOLATION"(blockedUri `[invalid-url]`, 출처 zod 가 든 청크)으로 남겼다
 * (2026-08-11부터 이사회실·정기총회 화면 7건, 2026-11-05 원인 확인). zod 는 탐지 실패 뒤 느린 경로로 정상 동작해
 * 기능 문제는 아니었고 보안 로그의 거짓 경보였다.
 *
 * 왜 모듈의 `z.config()`가 아니라 인라인 스크립트인가: 탐지는 스키마를 **만드는** 순간 일어나고, 최상위에서 `z.object`를
 * 만드는 클라이언트 모듈은 많다. 어떤 모듈이 먼저 평가될지 보장할 수 없어(실측: 설정 모듈을 공용 레이아웃에서 불러도 다른
 * 청크가 먼저 탐지했다) Next 의 스크립트보다 먼저 도는 `<head>` 인라인으로 zod 의 전역 설정 객체
 * (`globalThis.__zod_globalConfig`, zod/v4/core)에 `jitless`를 미리 넣는다. `script-src-elem`이 'unsafe-inline'을 허용한다.
 * 서버(SSR)는 CSP 와 무관해 그대로다.
 */
export const ZOD_JITLESS_INLINE_SCRIPT =
  'globalThis.__zod_globalConfig=Object.assign(globalThis.__zod_globalConfig||{},{jitless:true});'
