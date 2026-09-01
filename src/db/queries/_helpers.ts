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
