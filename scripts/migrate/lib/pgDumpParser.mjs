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

/**
 * `INSERT INTO "schema"."table" (` 다음의 컬럼 목록만 읽는다(`headerAt`은
 * 이미 찾은 헤더 시작 위치). 값(VALUES) 파싱은 하지 않으므로 행 수와
 * 무관하게 O(1)이다 — `parseInsertColumns`와 `parseOneInsertStatement`가
 * 공유한다.
 *
 * @returns { cols, colsEnd }
 */
function parseColumnList(sql, header, headerAt) {
  const colsEnd = sql.indexOf(')', headerAt + header.length)
  if (colsEnd === -1) {
    throw new Error(`INSERT 컬럼 목록이 닫히지 않았다 (위치 ${headerAt}): ${header}`)
  }
  const cols = sql
    .slice(headerAt + header.length, colsEnd)
    .split(',')
    .map(part => part.trim().replace(/^"|"$/g, ''))
  return { cols, colsEnd }
}

/**
 * 문장 하나(`INSERT INTO "schema"."table" (cols) VALUES (...),(...);`)를
 * `headerAt`에서 시작해 파싱한다. `;`로 제대로 끝나지 않거나 예기치 않은
 * 문자를 만나면 던진다 — 조용히 일부만 반환하지 않는다. `--rows-per-insert`로
 * 같은 표가 여러 INSERT 문으로 쪼개질 수 있으므로, 호출부(parseInsertRows)가
 * 이 함수를 표 전체에서 발견되는 모든 헤더 위치에 대해 반복 호출해 행을
 * 이어붙인다.
 *
 * @returns { cols, rows, endAt } endAt은 이 문장이 끝난(다음 검색을 시작할)
 * 위치다.
 */
function parseOneInsertStatement(sql, header, headerAt) {
  const { cols, colsEnd } = parseColumnList(sql, header, headerAt)

  const valuesAt = sql.indexOf('VALUES', colsEnd)
  if (valuesAt === -1) {
    throw new Error(`VALUES를 찾지 못했다 (위치 ${headerAt}): ${header}`)
  }

  const rows = []
  let i = valuesAt + 'VALUES'.length
  let terminated = false

  while (i < sql.length) {
    while (i < sql.length && /\s/.test(sql[i])) i++
    if (sql[i] === ';') {
      i++
      terminated = true
      break
    }
    if (sql[i] !== '(') {
      throw new Error(`${header}: 값 목록에서 예기치 않은 문자를 만나 파싱이 중단됐다 (위치 ${i})`)
    }
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
      throw new Error(`${header}: 값 하나가 ,나 )로 끝나지 않았다 (위치 ${i})`)
    }

    rows.push(
      Object.fromEntries(cols.map((c, j) => [c, values[j] === undefined ? null : values[j]]))
    )

    while (i < sql.length && /\s/.test(sql[i])) i++
    if (sql[i] === ',') {
      i++
      continue
    }
    if (sql[i] === ';') {
      i++
      terminated = true
      break
    }
    throw new Error(`${header}: 행 목록이 ,나 ;로 끝나지 않았다 (위치 ${i})`)
  }

  if (!terminated) {
    throw new Error(`${header}: INSERT 문이 ;로 끝나지 않은 채 입력이 끝났다 (위치 ${headerAt})`)
  }

  return { cols, rows, endAt: i }
}

/**
 * `schema.table`을 대상으로 하는 **모든** `INSERT INTO ... VALUES ...;`
 * 문장을 찾아 행을 이어붙인다.
 *
 * `pg_dump --rows-per-insert`가 걸리면 같은 표가 여러 INSERT 문으로 쪼개져
 * 나온다 — 첫 문장만 읽으면 나머지 행이 조용히 사라진다(되돌릴 수 없는
 * 손실 경로: Turso 쪽 검증이 파싱된 매핑 결과와 대조하므로 양쪽이 똑같이
 * 잘리면 "검증 통과"가 나온다). 그래서 여기서는 헤더가 더 안 나올 때까지
 * `sql.indexOf(header, searchFrom)`를 반복한다.
 *
 * 각 문장의 컬럼 목록이 다르면(같은 표인데 다른 컬럼 순서로 덤프될 이유가
 * 없다 — pg_dump는 표 하나당 컬럼 순서를 고정한다) 데이터 손상 신호이므로
 * 던진다.
 */
export function parseInsertRows(sql, schema, table) {
  const header = qualified(schema, table)
  let rows = []
  let cols = null
  let searchFrom = 0
  let found = false

  while (true) {
    const headerAt = sql.indexOf(header, searchFrom)
    if (headerAt === -1) break
    found = true

    const statement = parseOneInsertStatement(sql, header, headerAt)
    if (cols === null) {
      cols = statement.cols
    } else if (cols.join(' ') !== statement.cols.join(' ')) {
      throw new Error(
        `${header}: INSERT 문마다 컬럼 목록이 다르다 (위치 ${headerAt}) — 같은 표는 같은 컬럼 순서여야 한다`
      )
    }

    rows = rows.concat(statement.rows)
    searchFrom = statement.endAt
  }

  if (!found) return []
  return rows
}

/**
 * `schema.table`을 대상으로 하는 첫 `INSERT INTO ... (` 문의 컬럼 목록만
 * 읽는다(값은 파싱하지 않는다 — 행 수와 무관하게 O(1)). 헤더가 없으면
 * `null`을 돌려준다(그 표에 대한 INSERT 자체가 덤프에 없다는 뜻 — 운영에
 * 0행이라 pg_dump가 문장을 안 낸 경우가 정상적으로 여기 해당한다).
 *
 * 이관 스크립트가 "Postgres 덤프 컬럼 ⊆ 매퍼가 낸 키" 방향을 검사할 때
 * 쓴다 — 기존 커버리지 게이트(PRAGMA vs 매퍼)는 Turso 스키마와 매퍼만
 * 비교해서, Postgres에는 있는데 Turso 스키마에도 매퍼에도 없는 컬럼은
 * 두 게이트를 전부 통과하고 조용히 사라질 수 있었다.
 */
export function parseInsertColumns(sql, schema, table) {
  const header = qualified(schema, table)
  const headerAt = sql.indexOf(header)
  if (headerAt === -1) return null
  return parseColumnList(sql, header, headerAt).cols
}

/**
 * Postgres 배열 리터럴(`{a,b,c}`)을 JS 배열로 바꾼다. `text[]`·`uuid[]`
 * 컬럼이 `supabase db dump`를 거치면 이 형태의 문자열로 나온다(PostgREST를
 * 거치면 이미 진짜 배열이라 이 함수를 안 거친다 — `pgArrayToJsonText`가
 * 그 경우를 가려낸다).
 *
 * 따옴표로 감싼 원소(쉼표·이스케이프 포함 가능)와 안 감싼 원소(`NULL`
 * 키워드 포함) 둘 다 다룬다. 형식이 아니면 조용히 원문을 통과시키지 않고
 * 던진다 — 여기서 침묵하면 `artists.category` 같은 컬럼이 파싱 불가능한
 * 문자열 그대로 Turso에 들어가고, 읽는 쪽의 `JSON.parse`가 던지면서
 * 서비스가 죽는다(검증 단계는 매핑 결과 자체와 대조하므로 이 손상을
 * 못 잡는다).
 */
export function parsePgArrayLiteral(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new Error(`Postgres 배열 리터럴이 아니다: ${JSON.stringify(value)}`)
  }
  const trimmed = value.trim()
  if (trimmed === '{}') return []
  if (trimmed[0] !== '{' || trimmed[trimmed.length - 1] !== '}') {
    throw new Error(`Postgres 배열 리터럴 형식이 아니다: ${value}`)
  }

  const body = trimmed.slice(1, -1)
  const out = []
  let i = 0
  while (i < body.length) {
    if (body[i] === '"') {
      i++
      let elem = ''
      let closed = false
      while (i < body.length) {
        const c = body[i]
        if (c === '\\') {
          const next = body[i + 1]
          if (next === undefined) {
            throw new Error(`Postgres 배열 리터럴이 역슬래시로 끝났다: ${value}`)
          }
          elem += next
          i += 2
          continue
        }
        if (c === '"') {
          i++
          closed = true
          break
        }
        elem += c
        i++
      }
      if (!closed) {
        throw new Error(`Postgres 배열 리터럴의 따옴표가 닫히지 않았다: ${value}`)
      }
      out.push(elem)
    } else {
      let elem = ''
      while (i < body.length && body[i] !== ',') {
        elem += body[i]
        i++
      }
      out.push(elem === 'NULL' ? null : elem)
    }

    if (body[i] === ',') {
      i++
      continue
    }
    if (i < body.length) {
      throw new Error(`Postgres 배열 리터럴 파싱 중 예기치 않은 문자 (위치 ${i}): ${value}`)
    }
  }
  return out
}

/**
 * `text[]`/`uuid[]` 컬럼 값을 SQLite에 저장할 JSON 문자열로 바꾼다. 이미
 * 진짜 배열이면(PostgREST 경로) 그대로 직렬화하고, Postgres 배열 리터럴
 * 문자열이면(`supabase db dump` 경로) 먼저 `parsePgArrayLiteral`로 판다 —
 * 호출부가 어느 소스에서 왔는지 몰라도 안전하게 쓸 수 있다.
 */
export function pgArrayToJsonText(value, fallback) {
  if (value === null || value === undefined) {
    return fallback === undefined ? null : JSON.stringify(fallback)
  }
  const arr = Array.isArray(value) ? value : parsePgArrayLiteral(value)
  return JSON.stringify(arr)
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
