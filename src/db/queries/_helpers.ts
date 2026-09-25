/**
 * `src/db/queries/*` 전용 공용 변환 헬퍼.
 *
 * Drizzle 스키마는 camelCase 컬럼명을 쓰지만(`src/db/schema/identity.ts`),
 * API 응답 본문은 Supabase 시절부터 snake_case 키를 그대로 프런트가 읽는다
 * (CLAUDE.md: "응답 본문의 키는 snake_case를 유지해라" — strict: false라
 * 키가 바뀌어도 타입 검사가 못 잡고 화면이 조용히 빈다). 이 파일이 그
 * 경계를 한 곳에 모은다.
 */

import { sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

/** Drizzle의 camelCase 행 → API 응답용 snake_case 객체. 얕은 변환이다. */
export function toSnakeCase<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)] = value
  }
  return out
}

/**
 * snake_case 객체 → Drizzle이 기대하는 camelCase 객체. `toSnakeCase`의 역변환.
 * 라우트가 보내는 snake_case 쓰기 입력(`upsertProfile`/`updateProfile`의 인자)을
 * Drizzle의 `.values()`/`.set()`에 넘기기 전에 쓴다. 얕은 변환이다 — 중첩
 * 객체(`verification_status` 같은 JSON 컬럼)의 내부 키는 건드리지 않는다.
 */
export function toCamelCase(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())] = value
  }
  return out
}

/**
 * timestamp_ms 컬럼(Date | null) → ISO 문자열 | null.
 * Supabase는 timestamptz를 ISO 문자열로 돌려줬고 프런트가 그 형태를 파싱한다.
 * Drizzle의 mode:'timestamp_ms'는 Date를 돌려주므로 여기서 맞춰준다.
 */
export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/**
 * SQLite `LIKE`는 `%`·`_`를 와일드카드로 해석한다 — 사용자 입력을 그대로
 * `%${input}%`에 끼워 넣으면 검색어에 `%`나 `_`가 섞였을 때 의도한 부분일치가
 * 아니라 "아무 문자열"과 매치돼버린다. 실측: 공개 게시판 검색에서
 * `search=%%`(URL 인코딩된 `%25%25`)를 넣으면 검색어 없을 때와 완전히 같은
 * 응답이 나왔다(전체 목록) — 검색이 통째로 무력화되는 것이다. 파라미터
 * 바인딩은 이미 하고 있어 SQL 인젝션은 아니지만, 필터 자체가 뚫린다.
 *
 * `\`를 이스케이프 문자로 정하고, 이스케이프 문자 자신을 가장 먼저 치환한다
 * (나중에 치환하면 `%`→`\%`로 만든 `\`를 다시 이스케이프해버려 이중으로
 * 깨진다). 호출부는 반드시 SQL에 `ESCAPE '\'`(SQL 리터럴 기준 백슬래시
 * 하나)를 함께 붙여야 한다 — `LIKE_ESCAPE_CHAR`가 그 값이다.
 */
export const LIKE_ESCAPE_CHAR = '\\'

export function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * `column LIKE '%이스케이프된 needle%' ESCAPE '\'` 조건. Drizzle의 `like()`는
 * `ESCAPE` 절을 지원하지 않아 `sql` 템플릿으로 직접 만든다(파라미터 바인딩은
 * 그대로 유지 — 값을 SQL 문자열에 직접 이어붙이지 않는다). `posts.ts`
 * (공개 검색·관리자 고급검색·관리자 목록 검색 3곳)와 `profiles.ts`(회원
 * 검색)가 모두 이 함수를 쓴다 — 갈라지면 한 곳만 고쳐지는 문제를 막는다.
 */
export function likeContains(column: AnySQLiteColumn, needle: string): SQL {
  return sql`${column} LIKE ${'%' + escapeLikePattern(needle) + '%'} ESCAPE ${LIKE_ESCAPE_CHAR}`
}

/**
 * SQLite의 쓰기 잠금 경합인가.
 *
 * SQLite는 데이터베이스마다 쓰는 사람이 한 명이다. 원격 Turso에서는 문장
 * 하나가 왕복 하나라 트랜잭션이 잠금을 쥐는 시간이 길고, 그동안 다른 쓰기는
 * `SQLITE_BUSY`로 튕긴다. 경합은 고장이 아니라 일상이므로 잠시 뒤 다시 하면
 * 대개 지난다 — 판정 기준을 한 곳에 둬야 재시도하는 자리마다 다른 문자열을
 * 보는 일이 없다.
 */
export function isLockContention(error: unknown): boolean {
  const code = (error as { code?: string })?.code
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return true
  const message = error instanceof Error ? error.message : String(error)
  return /SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(message)
}

/**
 * 재시도 예산. 얼마나 끈질기게 기다릴 것인가.
 *
 * 경합에서 지는 쪽이 누구인가로 값이 갈린다. **돈이 걸린 쓰기**(승인 확정·
 * 환불 확정·원장 기록)가 지면 사람이 손으로 수습해야 한다 — 카드는 긁혔는데
 * 기록이 없는 상태다. 반대로 리워드 일괄 저장이 지면 개설자가 저장을 한 번 더
 * 누르면 그만이다. 그래서 전자는 오래 기다리고 후자는 일찍 물러난다.
 */
export interface RetryBudget {
  /** 첫 시도를 포함한 최대 시도 횟수. */
  attempts: number
  /** 첫 대기의 기준값(ms). 시도마다 두 배로 늘린다. */
  baseDelayMs: number
  /** 한 번의 대기 상한(ms). */
  maxDelayMs: number
}

/**
 * 기본 예산 — 25·50·75ms를 쉬고 물러난다(총 150ms 남짓).
 *
 * 리워드 일괄 저장처럼 **져도 사람이 다시 누르면 되는** 쓰기가 쓴다. 여기서
 * 끈질기게 버티면 잠금을 가장 오래 쥐는 트랜잭션이 네 번 더 달려드는 셈이라,
 * 그동안 결제 확정이 굶는다.
 */
export const DEFAULT_RETRY_BUDGET: RetryBudget = {
  attempts: 4,
  baseDelayMs: 25,
  maxDelayMs: 75,
}

/**
 * 돈이 걸린 쓰기의 예산 — 최악 2.7초까지 기다린다.
 *
 * 기본 예산(150ms)은 **같은 앱의 리워드 일괄 저장 하나를 못 견딘다.** 그
 * 트랜잭션은 문장이 스무 개 남짓이고 원격 Turso에서는 문장 하나가 왕복
 * 하나라, 잠금을 1초 가까이 쥘 수 있다. 결제 확정·환불 확정이 그 1초를 못
 * 기다리고 물러나면 **돈은 움직였는데 장부에 없는** 상태가 만들어진다 —
 * 그쪽이 훨씬 비싸므로 이쪽이 기다린다.
 */
export const MONEY_PATH_RETRY_BUDGET: RetryBudget = {
  attempts: 8,
  baseDelayMs: 40,
  maxDelayMs: 750,
}

/**
 * 락 경합만 다시 해 본다. 대기는 시도마다 두 배로 늘리고 절반은 흔든다.
 *
 * **흔드는 이유**: 같은 잠금에서 진 둘이 같은 간격으로 물러나면 다음 시도도
 * 나란히 부딪친다. 대기의 뒤쪽 절반을 무작위로 만들어 줄을 흐트러뜨린다
 * (앞쪽 절반은 남겨 둔다 — 전부 무작위로 하면 0에 가까운 대기가 나와 잠금이
 * 풀리기도 전에 다시 달려든다).
 *
 * `isFinal`이 참을 돌려주는 오류는 **다시 해도 같은 답**이므로 그대로 올린다
 * (매진·자리 없음 같은 판정). 그 밖의 오류도 경합이 아니면 그대로 올린다 —
 * 진짜 고장을 재시도로 덮으면 느려지기만 한다.
 */
export async function retryOnLockContention<T>(
  run: () => Promise<T>,
  isFinal: (error: unknown) => boolean = () => false,
  budget: RetryBudget = DEFAULT_RETRY_BUDGET
): Promise<T> {
  let lastError: unknown
  const attempts = Math.max(1, budget.attempts)
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (isFinal(error)) throw error
      if (!isLockContention(error)) throw error
      lastError = error
      const cap = Math.min(budget.maxDelayMs, budget.baseDelayMs * 2 ** attempt)
      const delay = cap / 2 + Math.random() * (cap / 2)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastError
}
