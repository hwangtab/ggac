/**
 * 인증 메일에 넣을 링크의 도메인 기준(base URL)을 고른다. 없으면 던진다.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test`가 `.ts`를 읽을 때 쓰는 타입
 * 스트리핑 모드는 확장자 없는 로컬 import를 해석하지 못한다(email.ts,
 * profileHook.ts, errorMessage.ts와 같은 관례).
 *
 * 예전 코드는 `NEXT_PUBLIC_SITE_URL || BETTER_AUTH_URL || ''`로, 둘 다
 * 없으면 빈 문자열로 조용히 폴백했다 — 그러면 메일에
 * `href="/reset-password?token=..."`처럼 스킴·호스트 없는 상대 경로가 그대로
 * 나간다. 받은 편지함에서는 열리지 않는 링크인데도 아무 로그가 안 남는다 —
 * "메일이 안 나감"보다 나쁘다(회원은 링크를 봤는데 왜 안 되는지 알 방법이
 * 없다). 이제는 여기서 던져 훅의 `[auth]` 로그 경로로 드러낸다.
 *
 * 주의: 이 우선순위(`NEXT_PUBLIC_SITE_URL` 우선)는 `src/lib/auth/server.ts`의
 * `betterAuth({ baseURL: ... })` 우선순위(`BETTER_AUTH_URL` 우선)와
 * **반대**다. 두 값이 다르게 설정된 환경(드물지만 가능)에서는 Better Auth
 * 자신의 baseURL과 메일에 박히는 도메인이 서로 다른 호스트를 가리킬 수
 * 있다는 뜻이다. Better Auth는 그 상황에서도 정상 부팅되므로 여기서 따로
 * 던지지 않으면 아무도 눈치채지 못한다 — 리뷰에서 지적된 비대칭이라 순서를
 * 바꾸지 않고 그대로 기록만 남긴다(둘 다 명시적으로 설정되면 일치시키는
 * 편이 더 안전하다).
 */
export function resolveEmailLinkBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL
  if (!base) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL과 BETTER_AUTH_URL이 둘 다 비어 있어 인증 메일 링크의 도메인을 만들 수 없습니다.'
    )
  }
  return base
}
