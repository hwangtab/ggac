/**
 * JSON 컬럼 "값 인코딩" 패리티.
 *
 * `check-schema-parity.mjs`는 표·컬럼 **이름**만 비교한다 — 값이 어떤 형태로
 * 들어갔는지는 보지 않는다. 그래서 Postgres `text[]`였던 컬럼이 Turso로 옮겨질
 * 때 JSON 배열(`["음악","영상"]`)이 아니라 Postgres 배열 리터럴
 * (`{음악,영상}`)로 들어가도 패리티는 통과한다.
 *
 * 그 상태가 실제로 만드는 사고(단계 4 리뷰 1회차 Important 3):
 *   `artists.category` 한 행이라도 오염되면 Drizzle의 `mode: 'json'` 디코딩이
 *   `listArtists()` 전체를 던진다("Expected property name or '}' in JSON at
 *   position 1"). `src/lib/data.ts`의 `getArtistsFromDB`는 그 예외를 catch로
 *   삼키고 `getArtistsFromJSON()`으로 폴백하므로 **에러도 빈 화면도 없이**
 *   공개 아티스트 목록·상세가 통째로 낡은 `data/artists.json`으로 되돌아간다.
 *   동시에 그 아티스트 조합원의 `/api/mypage/artist` GET은 500이 된다.
 *
 * 조용한 실패라서 사람이 눈치채지 못한다 — 컷오버 전에 여기서 잡아야 한다.
 */

/**
 * `mode: 'json'`으로 읽으면서 JSON 배열이어야 하는 컬럼들.
 * `src/db/schema/identity.ts`의 `artists.category`가 Postgres `text[]`에서
 * 옮겨온 유일한 컬럼이다(나머지 JSON 컬럼은 원본이 jsonb라 인코딩이 보존된다).
 */
export const JSON_ARRAY_COLUMN_CONTRACTS = [
  { table: 'artists', column: 'category', labelColumn: 'slug' },
]

/**
 * 한 계약에 대해 "JSON이 아니거나 배열이 아닌" 행만 골라내는 SQL.
 *
 * `json_type()`은 잘못된 JSON을 받으면 에러를 던지므로 `CASE`로 감싼다
 * (SQLite의 `OR`는 단락 평가를 보장하지 않는다). `NULL`은 위반이 아니다 —
 * 스키마상 nullable이고 Drizzle도 `null`을 그대로 돌려준다.
 */
export function buildJsonArrayCheckSql({ table, column, labelColumn }) {
  return `SELECT ${labelColumn} AS label, ${column} AS value
     FROM ${table}
    WHERE ${column} IS NOT NULL
      AND CASE WHEN json_valid(${column}) = 0 THEN 1 ELSE json_type(${column}) <> 'array' END`
}

/** 한 행이 왜 위반인지 사람이 읽을 문구로. */
export function describeViolation({ table, column }, row) {
  const raw = String(row.value)
  const preview = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw
  return `JSON 인코딩 위반: ${table}.${column} (${row.label}) = ${preview}`
}

/**
 * 모든 계약을 실제 DB에 대고 검사한다. libsql 클라이언트를 그대로 받는다 —
 * `run-parity-check.mjs`(운영/스테이징)와 단위 테스트(로컬 파일 DB)가 **같은
 * 코드 경로**를 쓰게 하기 위해서다.
 */
export async function findJsonEncodingViolations(client, contracts = JSON_ARRAY_COLUMN_CONTRACTS) {
  const violations = []
  for (const contract of contracts) {
    const result = await client.execute(buildJsonArrayCheckSql(contract))
    for (const row of result.rows) {
      violations.push({
        table: contract.table,
        column: contract.column,
        label: row.label === null ? null : String(row.label),
        value: String(row.value),
        message: describeViolation(contract, row),
      })
    }
  }
  return violations
}

export function formatJsonEncodingReport(violations, contracts = JSON_ARRAY_COLUMN_CONTRACTS) {
  if (violations.length) return violations.map(v => v.message).join('\n')
  return `JSON 인코딩 통과: ${contracts.map(c => `${c.table}.${c.column}`).join(', ')} 전 행이 JSON 배열`
}
