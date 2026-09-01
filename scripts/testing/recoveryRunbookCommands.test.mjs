import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 적대 감사(2026-08-27) — 재해복구 절차와 단계 5 덤프 절차의 명령이 **복붙하면
 * 동작하지 않았다.** 사고 한복판에서 이 문서를 펴 든 사람이 잃는 자리라
 * Critical로 분류됐다.
 *
 *  - 복구: `download-latest-backup.mjs`·`restore-from-dump.mjs`를 인자 없이 적어
 *    둘 다 exit 1이었고, 백업이 `.sql.gz`인데 **gunzip 단계가 통째로 없었다**.
 *  - 단계 5: `supabase db dump`가 기본 `--schema-only`인데 주석은 "데이터까지
 *    전부"라고 적혀 있었다 — 그대로 따르고 프로젝트를 지우면 **데이터가 영구
 *    소실**된다. 검증 ④는 `CREATE FUNCTION`을 세는데 CLI가 sed로
 *    `CREATE OR REPLACE FUNCTION`으로 바꾸므로 **정상 덤프에서도 항상 0**이었다.
 *
 * 문서를 테스트로 고정하는 이유: 이 저장소에서 가장 비싼 실패는 전부 "문서가
 * 사실과 달라 다음 사람이 잘못된 것을 믿은" 형태였다.
 */
const readme = readFileSync('scripts/turso/README.md', 'utf8')

test('복구 절차에 다운로드 경로 인자가 있다', () => {
  assert.match(
    readme,
    /download-latest-backup\.mjs "\$D\/latest\.sql\.gz"/,
    '인자가 없으면 usage만 찍고 exit 1이다'
  )
})

test('복구 절차에 gunzip 단계가 있다', () => {
  assert.match(
    readme,
    /gunzip -c "\$D\/latest\.sql\.gz"/,
    '백업은 .sql.gz인데 복원 스크립트는 SQL 텍스트를 읽는다 — 없으면 죽는다'
  )
})

test('복원 명령에 덤프 경로와 대상 URL 두 인자가 있다', () => {
  assert.match(readme, /restore-from-dump\.mjs "\$D\/latest\.sql" "file:\$D\/restored\.db"/)
})

test('복구 절차가 자격증명 로드를 안내한다', () => {
  const i = readme.indexOf('download-latest-backup.mjs "$D')
  const before = readme.slice(Math.max(0, i - 600), i)
  assert.match(before, /source \.env\.local/, 'PRIVATE_BLOB_READ_WRITE_TOKEN이 필요하다')
})

test('단계 5가 스키마·데이터·역할 세 덤프를 전부 뜬다', () => {
  assert.match(readme, /supabase db dump\s+--file/, '스키마 덤프')
  assert.match(readme, /supabase db dump --data-only\s+--file/, '기본 명령은 --schema-only다')
  assert.match(readme, /supabase db dump --role-only\s+--file/, '역할은 어느 쪽에도 안 담긴다')
})

test('함수 검증이 CREATE OR REPLACE FUNCTION을 센다', () => {
  assert.match(
    readme,
    /grep -c 'CREATE OR REPLACE FUNCTION'/,
    'CLI가 sed로 변환하므로 CREATE FUNCTION으로 세면 정상 덤프에서도 항상 0이다'
  )
  const i = readme.indexOf("grep -c 'CREATE OR REPLACE FUNCTION'")
  assert.match(readme.slice(i, i + 200), /기대: \d+/, '기대값 없는 검사는 실패할 수 없다')
})

test('역할 검증이 ALTER ROLE을 센다 (CREATE ROLE은 0이 정상)', () => {
  assert.match(
    readme,
    /grep -c 'ALTER ROLE'/,
    'Supabase 관리형 프로젝트엔 커스텀 역할이 없다 — CREATE ROLE로 세면 정상 덤프에서도 0이다'
  )
})

test('데이터 덤프에 auth 스키마가 담겼는지 검증한다', () => {
  assert.match(
    readme,
    /grep -c 'INSERT INTO "auth"\\\."users"'/,
    'public만 세면 조합원 23명의 인증 원본이 통째로 빠져도 통과한다'
  )
})
