import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 추출 결과 저장의 일시 연결 오류 재시도(`src/work/lib/files/transient-db.ts`). 2026-11-03 운영에서 정관 원본 PDF 추출이
 * 끝난 뒤 첫 저장이 libsql 소켓 끊김(`other side closed`)으로 세 번 다 실패해 failed 로 굳었다.
 */
const M = await import('../../src/work/lib/files/transient-db.ts')

function libsqlLike() {
  const socket = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  const fetchFailed = new TypeError('fetch failed', { cause: socket })
  return new Error('Failed query: select "id" from "board_documents"', { cause: fetchFailed })
}

test('원인 사슬 안의 소켓 끊김을 일시 오류로 본다', () => {
  assert.equal(M.isTransientDbError(libsqlLike()), true)
  assert.equal(M.isTransientDbError(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true)
})

test('제약 위반·입력 오류는 일시 오류가 아니다', () => {
  assert.equal(
    M.isTransientDbError(new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed')),
    false
  )
  assert.equal(M.isTransientDbError(null), false)
  assert.equal(M.isTransientDbError('fetch'), false)
})

test('일시 오류면 한 번 더 해서 성공한다', async () => {
  let calls = 0
  const out = await M.retryOnTransientDbError(async () => {
    calls++
    if (calls === 1) throw libsqlLike()
    return 'ok'
  })
  assert.equal(out, 'ok')
  assert.equal(calls, 2)
})

test('일시 오류가 아니면 다시 하지 않고 그대로 던진다', async () => {
  let calls = 0
  await assert.rejects(
    M.retryOnTransientDbError(async () => {
      calls++
      throw new Error('SQLITE_CONSTRAINT')
    }),
    /SQLITE_CONSTRAINT/
  )
  assert.equal(calls, 1)
})

test('두 번째도 실패하면 그 오류를 던진다(무한 재시도하지 않는다)', async () => {
  let calls = 0
  await assert.rejects(
    M.retryOnTransientDbError(async () => {
      calls++
      throw libsqlLike()
    })
  )
  assert.equal(calls, 2)
})
