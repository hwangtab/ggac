import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseInsertRows, pgTimestampToMs } from '../migrate/lib/pgDumpParser.mjs'

const SQL = `SET session_replication_role = replica;

--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: x
--

INSERT INTO "auth"."users" ("id", "email", "encrypted_password", "email_confirmed_at", "raw_meta") VALUES
\t('a1', 'a@x.kr', '$2a$10$abc', '2025-07-06 13:25:49.927557+00', '{"name":"홍길동"}'),
\t('b2', 'b@x.kr', '$2a$10$def', NULL, '{"note":"쉼표, 그리고 (괄호)"}'),
\t('c3', 'c@x.kr', '$2a$10$ghi', '2025-07-06 13:25:49+00', '{"q":"작은따옴표 '' 포함"}'),
\t('d4', 'd@x.kr', '$2a$10$jkl', NULL, E'{"path":"a\\\\\\\\b"}');


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: x
--

INSERT INTO "auth"."identities" ("id", "provider") VALUES
\t('i1', 'email');
`

test('INSERT 블록에서 지정 테이블만 파싱한다', () => {
  const rows = parseInsertRows(SQL, 'auth', 'users')
  assert.equal(rows.length, 4)
  assert.equal(rows[0].id, 'a1')
  assert.equal(rows[0].encrypted_password, '$2a$10$abc')
})

test('NULL 키워드를 자바스크립트 null로 돌려준다', () => {
  const rows = parseInsertRows(SQL, 'auth', 'users')
  assert.equal(rows[1].email_confirmed_at, null)
  assert.equal(rows[0].email_confirmed_at, '2025-07-06 13:25:49.927557+00')
})

test('따옴표 안의 쉼표와 괄호가 값을 자르지 않는다', () => {
  const rows = parseInsertRows(SQL, 'auth', 'users')
  assert.equal(rows[1].raw_meta, '{"note":"쉼표, 그리고 (괄호)"}')
})

test('두 겹 작은따옴표를 한 겹으로 푼다', () => {
  const rows = parseInsertRows(SQL, 'auth', 'users')
  assert.equal(rows[2].raw_meta, '{"q":"작은따옴표 \' 포함"}')
})

test('E 접두 문자열의 역슬래시 이스케이프를 푼다', () => {
  const rows = parseInsertRows(SQL, 'auth', 'users')
  assert.equal(rows[3].raw_meta, '{"path":"a\\\\b"}')
})

test('다른 테이블 블록으로 넘어가지 않는다', () => {
  assert.equal(parseInsertRows(SQL, 'auth', 'identities').length, 1)
})

test('없는 테이블은 빈 배열이다', () => {
  assert.deepEqual(parseInsertRows(SQL, 'auth', 'sessions'), [])
})

test('pg_dump의 공백 구분 타임스탬프를 밀리초로 바꾼다', () => {
  assert.equal(
    pgTimestampToMs('2025-07-06 13:25:49.927557+00'),
    Date.UTC(2025, 6, 6, 13, 25, 49, 927)
  )
})

test('PostgREST의 ISO 타임스탬프도 같은 값을 낸다', () => {
  assert.equal(
    pgTimestampToMs('2025-07-06T13:25:49.927557+00:00'),
    Date.UTC(2025, 6, 6, 13, 25, 49, 927)
  )
})

test('null은 null로 통과시킨다', () => {
  assert.equal(pgTimestampToMs(null), null)
})

test('해석 불가한 타임스탬프는 던진다', () => {
  assert.throws(() => pgTimestampToMs('언젠가'), /타임스탬프/)
})

// ---------------------------------------------------------------- 부정 대조: --rows-per-insert로 쪼개진 다중 INSERT

// pg_dump --rows-per-insert가 걸리면 같은 표가 이렇게 INSERT 문 여러 개로
// 쪼개져 나온다. 이 회귀 이전 코드(sql.indexOf(header) 1회)는 첫 문장의 2행만
// 읽고 두 번째 문장의 2행(n3, n4)을 조용히 놓쳤다 — content.mjs의 verifyContent가
// "파싱된 매핑 결과"와 Turso 행 수를 대조하므로, 양쪽이 똑같이 잘리면 검증도
// 통과해버리는 되돌릴 수 없는 손실 경로였다.
const SQL_SPLIT_NOTIFICATIONS = `SET session_replication_role = replica;

--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: x
--

INSERT INTO "public"."notifications" ("id", "user_id", "type") VALUES
\t('n1', 'u1', 'post_new'),
\t('n2', 'u1', 'post_reply');
INSERT INTO "public"."notifications" ("id", "user_id", "type") VALUES
\t('n3', 'u2', 'post_new'),
\t('n4', 'u2', 'post_reply');


--
-- Data for Name: posts; Type: TABLE DATA; Schema: public; Owner: x
--

INSERT INTO "public"."posts" ("id", "title") VALUES
\t('p1', 'hello');
`

test('같은 표에 대한 INSERT 문이 여러 개면 전부 이어붙인다 (--rows-per-insert 대응)', () => {
  const rows = parseInsertRows(SQL_SPLIT_NOTIFICATIONS, 'public', 'notifications')
  assert.equal(rows.length, 4)
  assert.deepEqual(
    rows.map(r => r.id),
    ['n1', 'n2', 'n3', 'n4']
  )
})

test('다중 INSERT 표 옆의 다른 표는 여전히 자기 행만 돌려준다(과잉 포함 없음)', () => {
  const rows = parseInsertRows(SQL_SPLIT_NOTIFICATIONS, 'public', 'posts')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'p1')
})

test('부정 대조 기반: 고쳐지기 전 동작은 첫 문장의 2행만 돌려줬다(회귀 문서화)', () => {
  // 위 정상 테스트가 4행을 요구하므로, 옛 구현(sql.indexOf 1회 호출)으로
  // 되돌아가면 이 값(2)과 달라져 위 테스트가 실패로 잡는다. 여기서는 옛
  // 동작을 별도로 재현해, "고치기 전에는 2행만 보였다"는 사실 자체를
  // 회귀 스위트에 고정해둔다.
  function legacyParseFirstStatementOnly(sql, schema, table) {
    const header = `INSERT INTO "${schema}"."${table}" (`
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
        const c = sql[i]
        if (c === "'") {
          let out = ''
          i++
          while (i < sql.length) {
            if (sql[i] === "'") {
              if (sql[i + 1] === "'") {
                out += "'"
                i += 2
                continue
              }
              i++
              break
            }
            out += sql[i]
            i++
          }
          values.push(out)
        } else {
          let out = ''
          while (i < sql.length && sql[i] !== ',' && sql[i] !== ')') {
            out += sql[i]
            i++
          }
          values.push(out.trim() === 'NULL' ? null : out.trim())
        }
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
        Object.fromEntries(cols.map((c2, j) => [c2, values[j] === undefined ? null : values[j]]))
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

  const legacyRows = legacyParseFirstStatementOnly(
    SQL_SPLIT_NOTIFICATIONS,
    'public',
    'notifications'
  )
  assert.equal(legacyRows.length, 2, '옛 구현은 첫 문장만 읽었다는 사실 자체를 고정한다')
  assert.deepEqual(
    legacyRows.map(r => r.id),
    ['n1', 'n2']
  )

  const fixedRows = parseInsertRows(SQL_SPLIT_NOTIFICATIONS, 'public', 'notifications')
  assert.equal(fixedRows.length, 4, '고친 구현은 두 문장을 모두 읽는다')
})

test('INSERT 문이 ;로 끝나지 않고 입력이 끝나면 조용히 일부만 반환하지 않고 던진다', () => {
  // 두 행 다 괄호까지는 제대로 닫혔지만(잘린 값이 아니라 잘린 파일 끝을
  // 흉내낸다), 마지막 `;`가 없다 — 예를 들어 덤프 파일 전송이 중간에
  // 끊긴 경우를 재현한다.
  const truncated = 'INSERT INTO "public"."notifications" ("id") VALUES\n\t(\'n1\'),\n\t(\'n2\')'
  assert.throws(() => parseInsertRows(truncated, 'public', 'notifications'), /;로 끝나지 않/)
})

test('값 목록이 콤마/괄호가 아닌 문자로 끊기면 던진다', () => {
  const broken = 'INSERT INTO "public"."notifications" ("id") VALUES\n\t(\'n1\' X);'
  assert.throws(() => parseInsertRows(broken, 'public', 'notifications'), /notifications/)
})

test('같은 표의 두 INSERT 문이 컬럼 순서가 다르면 던진다', () => {
  const mismatched = `INSERT INTO "public"."notifications" ("id", "user_id") VALUES ('n1', 'u1');
INSERT INTO "public"."notifications" ("user_id", "id") VALUES ('u2', 'n2');`
  assert.throws(() => parseInsertRows(mismatched, 'public', 'notifications'), /컬럼 목록이 다르다/)
})
