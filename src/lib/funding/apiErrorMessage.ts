/**
 * `@/utils/apiWrapper`의 `ApiError`는 실패 응답 본문을 `{ success: false, error: "<string>" }`로
 * 내려준다(`error`가 객체가 아니라 문자열). 화면 쪽에서 관성적으로 `json?.error?.message`를
 * 읽으면 항상 `undefined`가 되어 서버가 보낸 구체적인 사유가 버려지고 기본 문구만 보인다.
 *
 * 이 헬퍼는 `error`가 문자열이면 그대로 쓰고, 혹시 객체 형태(`{ message }`)로 오는 과거·다른
 * 응답이 섞여 있어도 대응하도록 `error.message`까지 본 뒤, 둘 다 없으면 `fallback`을 쓴다.
 */
export function apiErrorMessage(json: unknown, fallback: string): string {
  const error = (json as { error?: unknown } | null | undefined)?.error
  if (typeof error === 'string' && error.length > 0) return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return fallback
}
