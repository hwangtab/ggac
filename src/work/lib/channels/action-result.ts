import type { ZodError } from 'zod'
import { getPostgresErrorCode } from '@work/lib/supabase/errors'

/**
 * 메시징 서버 액션의 공통 반환형. 서버 액션은 던지지 않고 이 모양으로 돌려준다
 * (클라이언트가 낙관적 갱신을 되돌릴지 판단해야 하므로).
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; error?: undefined }
  | { ok: false; error: string; data?: undefined }
// ggac 이식: ggac는 `strict: false`라 `ok` 불리언 판별로 유니온이 좁혀지지 않는다(strictNullChecks가 꺼져 있으면
// 리터럴 판별이 동작하지 않는다). 양쪽에 상대 키를 `?: undefined`로 두어 원본 코드의 `if (!r.ok) r.error`·`r.data`
// 접근이 그대로 컴파일되게 했다. 런타임 모양은 원본과 같다.

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

export function fail<T = never>(error: string): ActionResult<T> {
  return { ok: false, error }
}

/** zod 검증 실패 → 첫 메시지 */
export function invalid<T = never>(error: ZodError): ActionResult<T> {
  return fail(error.issues[0]?.message ?? '입력값을 확인해 주세요.')
}

export const FORBIDDEN_MESSAGE = '이 작업을 할 권한이 없습니다.'
export const GENERIC_MESSAGE = '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/**
 * 로그에 남길 오류 요약 — **메시지·쿼리 값은 싣지 않는다.** drizzle 의 쿼리 오류는 메시지에 `params: …`(넘긴 값 전부)를 담아,
 * DM·메모 본문을 저장하다 DB 가 잠깐 실패하면 본문이 그대로 런타임 로그에 남았다(2026-11-05 점검). 이름·코드만 원인 사슬에서
 * 모은다(예: `Error > TypeError(fetch failed) > SocketError UND_ERR_SOCKET`의 이름·코드).
 */
export function errorSummaryForLog(error: unknown): { chain: string[] } {
  const chain: string[] = []
  let cur: unknown = error
  for (let depth = 0; cur && depth < 6; depth++) {
    const o = cur as { name?: unknown; code?: unknown; cause?: unknown }
    const name = typeof o.name === 'string' ? o.name : typeof cur
    const code = typeof o.code === 'string' || typeof o.code === 'number' ? ` ${o.code}` : ''
    chain.push(`${name}${code}`)
    cur = o.cause
  }
  return { chain }
}

/** Postgres/PostgREST 오류 → 사용자 문구. 오류는 이름·코드만 로그로 남긴다(본문이 섞이지 않게 — `errorSummaryForLog`). */
export function dbFailure<T = never>(where: string, error: unknown): ActionResult<T> {
  console.error(`[${where}]`, errorSummaryForLog(error))
  const code = getPostgresErrorCode(error)
  // 42501 insufficient_privilege(RLS·하드닝 트리거), PGRST301 JWT 문제
  if (code === '42501' || code === 'PGRST301') return fail(FORBIDDEN_MESSAGE)
  return fail(GENERIC_MESSAGE)
}
