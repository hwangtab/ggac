/**
 * GoTrue가 `admin.createUser` 호출에 대해 돌려주는 에러가 "그림자 행이 이미
 * 준비돼 있다"는 뜻의 무해한 재시도인지 판정한다.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test`가 `.ts`를 읽을 때 쓰는 타입
 * 스트리핑 모드는 확장자 없는 로컬 import를 해석하지 못한다(email.ts,
 * profileHook.ts, errorMessage.ts와 같은 관례).
 *
 * 실측(로컬 GoTrue v2.188.1, curl로 raw HTTP·`@supabase/supabase-js` 양쪽
 * 확인, `src/lib/auth/server.ts`의 `ensureSupabaseAuthShadowUser` 호출부
 * 참조):
 *   - 완전 동일 id·email 재시도 → HTTP 422
 *     `{"code":422,"error_code":"email_exists","msg":"..."}`, SDK에서는
 *     `error.code === 'email_exists'` → 무해(true).
 *   - id는 같고 email만 다른 경우(우리는 이 모양으로 호출하지 않지만 확인차
 *     시도) → 이 GoTrue 버전은 검증 단계에서 안 걸러 raw Postgres 23505
 *     (`users_pkey` 위반)가 그대로 500으로 샌다 → 진짜 실패(false).
 *   - 이메일 형식이 잘못된 경우 → HTTP 400
 *     `{"code":400,"error_code":"validation_failed","msg":"..."}` →
 *     진짜 실패(false).
 * `@supabase/auth-js`의 `ErrorCode` 타입에는 `user_already_exists`도
 * 존재하지만, 이 호출 모양(명시적 id를 주는 `admin.createUser`)에서는
 * 재현되지 않았다 — 매칭 코드에 넣지 않는다.
 *
 * status만으로 4xx를 뭉뚱그리면 이메일 형식 오류 같은 진짜 검증 실패도
 * 조용히 삼켜버려서, 뒤이은 프로필 upsert가 FK 위반으로 실패했을 때 로그가
 * 진짜 원인이 아니라 엉뚱한 FK를 가리키게 된다 — 그래서 `error.code ===
 * 'email_exists'`로 좁혀 판정한다.
 */
export function isBenignShadowUserRetryError(error: unknown): boolean {
  if (error === null || error === undefined) return false
  if (typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 'email_exists'
}
