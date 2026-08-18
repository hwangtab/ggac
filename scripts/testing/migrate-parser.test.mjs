import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseInsertRows, pgTimestampToMs } from '../migrate/lib/pgDumpParser.mjs'

const SQL = `SET session_replication_role = replica;

--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: x
--

INSERT INTO "auth"."users" ("id", "email", "encrypted_password", "email_confirmed_at", "raw_meta") VALUES
\t('a1', 'a@x.kr', '$2a$10$abc', '2025-07-06 13:25:49.927557+00', '{"name":"황경하"}'),
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

test("두 겹 작은따옴표를 한 겹으로 푼다", () => {
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
