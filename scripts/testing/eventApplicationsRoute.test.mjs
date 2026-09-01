import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * 이벤트 신청 라우트가 insert 전에 중복 검사를 부르는지, 그리고 막힐 때
 * 409를 돌려주는지 못박는다. 동작 검증(실제 중복 판정)은
 * `scripts/testing/queriesEventApplications.test.mjs`가 실제 DB로 한다 —
 * 이 파일은 라우트가 그 함수를 실제로 배선했는지만 본다.
 */

const ROUTE = new URL('../../src/app/api/event-applications/route.ts', import.meta.url)

test('insert 전에 중복 검사를 부른다', async () => {
  const src = await readFile(ROUTE, 'utf8')
  const checkAt = src.indexOf('hasEventApplicationForContact(')
  const insertAt = src.indexOf('createEventApplication(cleanedData)')
  assert.ok(checkAt > 0, 'hasEventApplicationForContact 호출을 찾지 못했다')
  assert.ok(insertAt > 0, 'createEventApplication 호출을 찾지 못했다')
  assert.ok(checkAt < insertAt, '중복 검사가 insert보다 먼저여야 한다')
})

test('중복이면 409를 돌려준다', async () => {
  const src = await readFile(ROUTE, 'utf8')
  const block = src.slice(
    src.indexOf('if (alreadyApplied)'),
    src.indexOf('let inserted: { id: string }')
  )
  assert.match(block, /ApiError\.conflict\(/)
})
