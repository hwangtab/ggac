/**
 * `supabase db dump --data-only`가 만든 SQL에서 특정 테이블의 행을 뽑는다.
 *
 * 이 CLI(v2.84.2)는 탭 구분 `COPY ... FROM stdin` 블록이 아니라
 * `INSERT INTO "schema"."table" (cols) VALUES (...),(...);` 형태를 낸다.
 * COPY를 기대하는 파서는 예외 없이 0행을 돌려주므로, 호출부는 반드시
 * 반환 행수를 기대치와 대조해야 한다.
 *
 * 이 파일은 어떤 로컬 모듈도 import하지 않는다 — 순수 함수만 담아
 * 픽스처로 단위 테스트할 수 있게 유지한다.
 */

/** SQL 식별자를 `"auth"."users"` 형태로 만든다. */
function qualified(schema, table) {
  return `INSERT INTO "${schema}"."${table}" (`
}

/**
 * 값 하나를 읽고 [값, 다음 인덱스]를 돌려준다.
 * 문자열 리터럴은 작은따옴표로 감싸이고 내부의 작은따옴표는 두 겹(`''`)으로
 * 이스케이프된다. 문자열에 역슬래시가 있으면 pg_dump는 `E'...'` 형태를 쓰고
 * 이때만 역슬래시가 C 스타일 이스케이프로 해석된다.
 */
function readValue(body, start) {
  let i = start
  while (i < body.length && /\s/.test(body[i])) i++

  const isEscapeString = body[i] === 'E' && body[i + 1] === "'"
  if (isEscapeString) i++

  if (body[i] === "'") {
    i++
    let out = ''
    while (i < body.length) {
      const c = body[i]
      if (c === "'") {
        if (body[i + 1] === "'") {
          out += "'"
          i += 2
          continue
        }
        i++
        break
      }
      if (isEscapeString && c === '\\') {
        const next = body[i + 1]
        // pg_dump가 실제로 내는 이스케이프만 처리한다. 그 밖의 문자는
        // 역슬래시를 떼고 문자 자체를 남기는 Postgres 규칙을 따른다.
        const mapped = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '\\': '\\', "'": "'" }
        out += Object.prototype.hasOwnProperty.call(mapped, next) ? mapped[next] : next
        i += 2
        continue
      }
      out += c
      i++
    }
    return [out, i]
  }

  // 따옴표 없는 값: NULL, 숫자, true/false
  let out = ''
  while (i < body.length && body[i] !== ',' && body[i] !== ')') {
    out += body[i]
    i++
  }
  const trimmed = out.trim()
  return [trimmed === 'NULL' ? null : trimmed, i]
}

export function parseInsertRows(sql, schema, table) {
  const header = qualified(schema, table)
  const headerAt = sql.indexOf(header)
  if (headerAt === -1) return []

  const colsEnd = sql.indexOf(')', headerAt + header.length)
  const cols = sql
    .slice(headerAt + header.length, colsEnd)
    .split(',')
    .map(part => part.trim().replace(/^"|"$/g, ''))

  const valuesAt = sql.indexOf('VALUES', colsEnd)
  if (valuesAt === -1) return []

  const rows = []
  let i = valuesAt + 'VALUES'.length

  while (i < sql.length) {
    while (i < sql.length && /\s/.test(sql[i])) i++
    if (sql[i] === ';' || i >= sql.length) break
    if (sql[i] !== '(') break
    i++

    const values = []
    while (i < sql.length) {
      const [value, next] = readValue(sql, i)
      values.push(value)
      i = next
      if (sql[i] === ',') {
        i++
        continue
      }
      if (sql[i] === ')') {
        i++
        break
      }
      break
    }

    rows.push(
      Object.fromEntries(cols.map((c, j) => [c, values[j] === undefined ? null : values[j]]))
    )

    while (i < sql.length && /\s/.test(sql[i])) i++
    if (sql[i] === ',') {
      i++
      continue
    }
    break
  }

  return rows
}

/**
 * Postgres 타임스탬프를 epoch 밀리초로 바꾼다.
 *
 * 두 가지 형식을 모두 받는다:
 *   pg_dump    `2025-07-06 13:25:49.927557+00`   (공백 구분, 오프셋에 콜론 없음)
 *   PostgREST  `2025-07-06T13:25:49.927557+00:00`(ISO)
 * 전자를 Date.parse에 그대로 넣으면 명세상 구현 정의 동작이라 엔진에 따라
 * NaN이 될 수 있다 — 그래서 ISO로 정규화한 뒤 파싱하고, 실패하면 던진다.
 * 조용히 null이나 0을 돌려주면 19명의 가입 시각이 1970년으로 바뀐다.
 */
export function pgTimestampToMs(value) {
  if (value === null || value === undefined || value === '') return null

  let normalized = String(value).trim().replace(' ', 'T')
  // `+00` → `+00:00`, `-0930` → `-09:30`. 이미 콜론이 있으면 그대로 둔다.
  normalized = normalized.replace(
    /([+-])(\d{2})(\d{2})?$/,
    (_m, sign, hh, mm) => `${sign}${hh}:${mm ?? '00'}`
  )

  const ms = Date.parse(normalized)
  if (Number.isNaN(ms)) {
    throw new Error(`타임스탬프를 해석할 수 없다: ${value}`)
  }
  return ms
}
