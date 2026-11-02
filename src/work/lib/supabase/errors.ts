import { isWorkWriteError } from '@/db/queries/work/_shared'
import { isSqliteUniqueViolation } from '@/db/queries/work/channels'

/**
 * 원본 `lib/supabase/errors.ts`(Postgres SQLSTATE 판별) 자리 — 설계 §5: "SQLite 에러는 모양이 다르므로
 * SQLite용 판정 함수를 둔다". 옮긴 `action-result.ts`의 `dbFailure`가 코드로 사용자 문구를 고르므로,
 * 쿼리 계층의 `WorkWriteError`(원본 트리거의 raise exception 자리)와 SQLite 제약 위반을 **원본과 같은 SQLSTATE**로 바꿔 준다.
 *
 * | 여기                                        | 원본 SQLSTATE |
 * | ------------------------------------------- | ------------- |
 * | WorkWriteError forbidden·archived·owners_only | 42501         |
 * | WorkWriteError invalid_parent·invalid_quote·invalid_target | 23514 |
 * | WorkWriteError not_found                    | 23503         |
 * | WorkWriteError conflict · SQLite UNIQUE/PK  | 23505         |
 * | SQLite FOREIGN KEY                          | 23503         |
 */
export function getPostgresErrorCode(error: unknown): string | undefined {
  if (isWorkWriteError(error)) {
    switch (error.code) {
      case 'forbidden':
      case 'archived':
      case 'owners_only':
      case 'deleted':
        return '42501'
      case 'invalid_parent':
      case 'invalid_quote':
      case 'invalid_target':
        return '23514'
      case 'not_found':
        return '23503'
      case 'conflict':
        return '23505'
    }
  }
  if (isSqliteUniqueViolation(error)) return '23505'
  const text = errorText(error)
  if (text.includes('FOREIGN KEY constraint failed')) return '23503'
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
  }
  return undefined
}

/** unique_violation(23505) — 멱등 처리·충돌 안내 분기용 */
export function isUniqueViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === '23505'
}

function errorText(error: unknown): string {
  const parts: string[] = []
  let e: unknown = error
  for (let i = 0; e && i < 5; i++) {
    if (typeof e === 'object') {
      const m = (e as { message?: unknown }).message
      if (typeof m === 'string') parts.push(m)
      e = (e as { cause?: unknown }).cause
    } else break
  }
  return parts.join(' ')
}
