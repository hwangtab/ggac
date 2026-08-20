/**
 * 로그에 안전하게 남길 수 있는 에러 메시지를 고른다.
 *
 * 로컬 import가 하나도 없어야 한다 — `node --test`가 `.ts`를 읽을 때 쓰는 타입
 * 스트리핑 모드는 확장자 없는 로컬 import를 해석하지 못한다(email.ts,
 * profileHook.ts와 같은 관례).
 *
 * 이 파일이 처리해야 하는 모양은 실측으로 확인한 두 가지다:
 *
 * 1. drizzle의 `DrizzleQueryError#message`는 `Failed query: ...\nparams: ...`
 *    형태로 **쿼리 바인딩 파라미터 전체**를 담는다 — member_profiles INSERT
 *    실패 시 email·display_name(실명일 수 있다) 등 개인정보가 그대로 로그에
 *    찍힌다는 뜻이다. 반면 `error.cause`는 DB 드라이버가 던진 원인 오류만
 *    담는다(예: `SQLITE_CONSTRAINT: UNIQUE constraint failed:
 *    member_profiles.email`) — 원인 파악에는 충분하고 파라미터는 없다. 그래서
 *    `Error`는 `cause`가 `Error`면 그쪽을 우선한다.
 * 2. Supabase `@supabase/supabase-js`가 돌려주는 에러(`PostgrestError` 등)는
 *    이 저장소가 쓰는 클라이언트 런타임에서 **`Error`를 상속하지 않는 일반
 *    객체**로 온다(실측: `error instanceof Error === false`,
 *    `error.constructor.name === 'Object'`). 예전 코드는 이 경우를 다루지
 *    않아 `String(error)`로 떨어져 로그에 `[object Object]`만 남았다 —
 *    가입 훅의 실패는 로그로만 드러나므로(가입 자체는 실패시키지 않는 정책),
 *    이 문제는 "새 가입자가 관리자에게 안 보인다"는 원래 버그를
 *    "실패 원인이 안 보인다"는 형태로 재현한 것과 같았다.
 *
 *    `message` 필드에는 제약 이름 등 원인만 담기고(예: `insert or update on
 *    table "member_profiles" violates foreign key constraint
 *    "member_profiles_id_fkey"`) 행 값은 없다. 반면 `details`는 위반한 행의
 *    실제 값을 그대로 echo하는 경우가 흔하고 `hint`도 스키마 내부 정보를
 *    노출할 수 있어 — drizzle의 파라미터 유출을 피하려던 원래 목적과 같은
 *    이유로 — 둘 다 일부러 뺀다. `code`는 값이 아니라 안정적인 분류값(예:
 *    `23503`)이라 함께 남겨도 안전하고, 원인 분류에 유용하다.
 *
 * 그 외(문자열, 숫자, `message`가 없는 객체 등)는 기존과 같이
 * `String(error)`로 폴백한다.
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.cause instanceof Error) {
      return error.cause.message
    }
    return error.message
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    const message = (error as { message: string }).message
    const code = 'code' in error ? (error as { code: unknown }).code : undefined
    return typeof code === 'string' && code.length > 0 ? `${code}: ${message}` : message
  }
  return String(error)
}
