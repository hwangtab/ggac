/**
 * `src/db/queries/*` 전용 공용 변환 헬퍼.
 *
 * Drizzle 스키마는 camelCase 컬럼명을 쓰지만(`src/db/schema/identity.ts`),
 * API 응답 본문은 Supabase 시절부터 snake_case 키를 그대로 프런트가 읽는다
 * (CLAUDE.md: "응답 본문의 키는 snake_case를 유지해라" — strict: false라
 * 키가 바뀌어도 타입 검사가 못 잡고 화면이 조용히 빈다). 이 파일이 그
 * 경계를 한 곳에 모은다.
 */

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
