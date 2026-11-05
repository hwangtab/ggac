import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 업무툴 서버 액션의 DB 실패 로그가 쿼리 값(DM·메모 본문)을 싣지 않는다(2026-11-05 점검). drizzle 의 쿼리 오류는 메시지에
 * `params: …`로 넘긴 값 전부를 담는다 — `dbFailure`가 그 오류를 그대로 찍어 본문이 런타임 로그에 남았다.
 */
const M = await import('../../src/work/lib/channels/action-result.ts')

const SECRET = '감사님께만 드리는 비밀 DM 본문'

function drizzleLike() {
  const socket = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  const fetchFailed = new TypeError('fetch failed', { cause: socket })
  return Object.assign(
    new Error(`Failed query: insert into "work_messages" ("body") values (?)\nparams: ${SECRET}`, {
      cause: fetchFailed,
    }),
    { name: 'DrizzleQueryError' }
  )
}

test('오류 요약은 이름·코드만 — 메시지·쿼리 값은 없다', () => {
  const summary = M.errorSummaryForLog(drizzleLike())
  assert.deepEqual(summary.chain, ['DrizzleQueryError', 'TypeError', 'Error UND_ERR_SOCKET'])
  assert.equal(JSON.stringify(summary).includes(SECRET), false)
})

test('dbFailure 는 본문을 로그에 남기지 않고 일반 안내를 돌려준다', () => {
  const logged = []
  const original = console.error
  console.error = (...args) => logged.push(args)
  try {
    const r = M.dbFailure('sendMessage', drizzleLike())
    assert.equal(r.ok, false)
    assert.equal(r.error, M.GENERIC_MESSAGE)
  } finally {
    console.error = original
  }
  assert.equal(logged.length, 1)
  assert.equal(JSON.stringify(logged).includes(SECRET), false, '로그에 DM 본문이 남았다')
})
