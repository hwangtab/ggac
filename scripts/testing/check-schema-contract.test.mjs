import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkContract } from './check-schema-contract.mjs'

const snapshot = {
  tables: { posts: ['id', 'title'], users: ['id', 'name'] },
  rpcs: ['increment_view_count'],
}
const emptyAllow = { tables: [], columns: {}, rpcs: [] }

test('없는 테이블·컬럼·RPC를 위반으로 보고한다', () => {
  const usages = [
    { file: 'a.ts', line: 1, table: 'member_profiles', columns: ['id'], relations: [] },
    { file: 'b.ts', line: 2, table: 'posts', columns: ['id', 'profile_photo_url'], relations: [] },
    { file: 'c.ts', line: 3, rpc: 'nonexistent_fn' },
  ]
  const violations = checkContract(usages, snapshot, emptyAllow)
  assert.equal(violations.length, 3)
  assert.deepEqual(violations.map(v => v.kind).sort(), ['column', 'rpc', 'table'])
})

test('관계 임베딩의 컬럼도 대상 테이블 기준으로 검사한다', () => {
  const usages = [
    {
      file: 'a.ts',
      line: 1,
      table: 'posts',
      columns: ['id'],
      relations: [{ name: 'users', columns: ['name', 'ghost_col'] }],
    },
  ]
  const violations = checkContract(usages, snapshot, emptyAllow)
  assert.equal(violations.length, 1)
  assert.match(violations[0].detail, /users.*ghost_col/)
})

test('스냅샷에 없는 관계명은 위반이 아니라 통과시킨다 (FK 별칭 가능성)', () => {
  const usages = [
    {
      file: 'a.ts',
      line: 1,
      table: 'posts',
      columns: [],
      relations: [{ name: 'author', columns: ['whatever'] }],
    },
  ]
  assert.equal(checkContract(usages, snapshot, emptyAllow).length, 0)
})

test('allowlist에 있는 항목은 위반에서 제외한다', () => {
  const usages = [
    { file: 'a.ts', line: 1, table: 'some_view', columns: ['id'], relations: [] },
    { file: 'b.ts', line: 2, table: 'posts', columns: ['computed_col'], relations: [] },
  ]
  const allow = { tables: ['some_view'], columns: { posts: ['computed_col'] }, rpcs: [] }
  assert.equal(checkContract(usages, snapshot, allow).length, 0)
})
