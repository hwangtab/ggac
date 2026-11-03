import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 권한 E2E 시드(seed-authz-fixtures.mjs)의 계정은 **고정 id**다. 두 브랜치가 따로 같은 값을 고르면
// (2026-11-03: 이사회 업무툴의 auditor와 타임뱅크의 suspended가 둘 다 …b00a) 나중 행이 앞 행을 덮어
// 한쪽 계정의 로그인이 조용히 깨진다 — authz-setup이 "로그인 화면에 머문다"로만 실패해 원인이 안 보인다.
// 시드는 실행하면 DB에 쓰므로 import하지 않고 원문에서 ACCOUNTS 블록을 읽는다.
const src = readFileSync(new URL('./seed-authz-fixtures.mjs', import.meta.url), 'utf8')
const block = src.slice(
  src.indexOf('export const ACCOUNTS = ['),
  src.indexOf('\n]\n', src.indexOf('export const ACCOUNTS = ['))
)

test('권한 E2E 시드 계정의 고정 id·이메일은 서로 겹치지 않는다', () => {
  const ids = [...block.matchAll(/^\s+id: '([0-9a-f-]{36})'/gm)].map(m => m[1])
  const emails = [...block.matchAll(/^\s+email: '([^']+)'/gm)].map(m => m[1])
  assert.ok(
    ids.length >= 10,
    `ACCOUNTS에서 id를 ${ids.length}개밖에 못 읽었다 — 시드 모양이 바뀌었는지 확인`
  )
  const dup = list => list.filter((v, i) => list.indexOf(v) !== i)
  assert.deepEqual(dup(ids), [], '같은 고정 id를 둘 이상의 계정이 쓴다')
  assert.deepEqual(dup(emails), [], '같은 이메일을 둘 이상의 계정이 쓴다')
})
