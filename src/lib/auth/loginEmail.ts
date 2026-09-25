/**
 * 로그인 식별자(이메일)를 **Better Auth와 똑같은 방식으로** 접는다.
 *
 * ## 왜 이 파일이 따로 있나
 *
 * 이메일 인증 관문(`emailVerificationGate.ts`)은 Better Auth가 인증할 계정과
 * **같은 계정**을 찾아야 한다. 한 글자라도 다르게 찾으면 관문은 "그런 계정
 * 없음"을 보고 비켜 주고, Better Auth는 같은 요청으로 로그인을 성립시킨다.
 * 실제로 그렇게 뚫렸다 — 저장된 주소가 `user@example.com`인데
 * `User@Example.com`으로 보내면 관문의 `eq(user.email, email)`이 0행을
 * 돌려줬다.
 *
 * 그래서 접는 방법을 한 군데에만 둔다. 라우트와 쿼리 계층이 각자 접으면
 * 언젠가 한쪽만 바뀌고, 그 순간 같은 구멍이 다시 열린다.
 *
 * ## Better Auth가 실제로 하는 일 (better-auth 1.6.26 실측)
 *
 * - 저장: `dist/db/internal-adapter.mjs`의 `createUser`가
 *   `email: user.email?.toLowerCase()`로 **소문자로 눕혀 저장**한다.
 * - 조회: 같은 파일의 `findUserByEmail`이
 *   `where: [{ field: 'email', value: email.toLowerCase() }]`로 찾는다.
 *   `/sign-in/email` 핸들러(`dist/api/routes/sign-in.mjs`)는 이 함수를 쓴다.
 *
 * 즉 Better Auth의 정규화는 **로케일을 모르는 `toLowerCase()` 하나**다.
 * `toLocaleLowerCase()`를 쓰면 안 된다 — 터키어 로케일에서 `'I'`가 `'ı'`가
 * 되어 Better Auth가 찾는 값과 달라진다. 추측하지 말고 같은 함수를 쓴다.
 *
 * ## 앞뒤 공백은 왜 더 지우나
 *
 * Better Auth는 공백을 지우지 않는다. 대신 `z.email()`이 앞뒤 공백이 붙은
 * 주소를 400(INVALID_EMAIL)으로 먼저 돌려보낸다. 그래서 여기서 `trim()`을
 * 더 하는 것은 **관문이 더 많이 알아보는 방향**의 차이뿐이다 — 관문이
 * 붙잡는 요청은 Better Auth가 어차피 거절하는 요청이고, 그 반대(관문이
 * 놓치는데 Better Auth는 통과시키는 조합)는 생기지 않는다. 관문에서 위험한
 * 것은 오직 후자다.
 *
 * @returns 접은 주소. 문자열이 아니거나 비어 있으면 빈 문자열.
 */
export function normalizeLoginEmail(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}
