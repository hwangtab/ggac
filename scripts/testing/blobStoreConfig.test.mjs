import { test } from 'node:test'
import assert from 'node:assert/strict'

const { hasPrivateBlobStore, getPrivateObject } = await import('../../src/lib/storage/blob.ts')

// 교차 제공자 폴백의 문지기. getBoardDocumentStream은 "현재 제공자에 없으면
// 반대쪽도 본다"인데, 반대쪽이 설정돼 있지 않은 상태(전환 전 / 롤백 후)가
// 정상이다. 그때 getPrivateObject를 그냥 부르면 requireEnv가 던져서, 없는
// 문서 요청이 404가 아니라 환경변수 이름이 담긴 500으로 나간다.
// 이 판정이 그 호출을 막는다.

const TOKEN = 'PRIVATE_BLOB_READ_WRITE_TOKEN'

function withToken(value, fn) {
  const before = process.env[TOKEN]
  if (value === undefined) delete process.env[TOKEN]
  else process.env[TOKEN] = value
  try {
    return fn()
  } finally {
    if (before === undefined) delete process.env[TOKEN]
    else process.env[TOKEN] = before
  }
}

test('토큰이 없으면 미설정으로 본다', () => {
  withToken(undefined, () => assert.equal(hasPrivateBlobStore(), false))
})

test('빈 문자열과 공백만 있는 값도 미설정으로 본다', () => {
  // requireServerEnv가 쓰는 trim 기준과 맞춘다 — 배포 환경에서 빈 값이
  // 설정된 것으로 잡히면 폴백이 다시 던지게 된다.
  withToken('', () => assert.equal(hasPrivateBlobStore(), false))
  withToken('   ', () => assert.equal(hasPrivateBlobStore(), false))
  withToken('\n\t', () => assert.equal(hasPrivateBlobStore(), false))
})

test('값이 있으면 설정된 것으로 본다', () => {
  withToken('vercel_blob_rw_example', () => assert.equal(hasPrivateBlobStore(), true))
})

test('미설정 상태에서 getPrivateObject는 null이 아니라 던진다 (판정이 필요한 이유)', async () => {
  const before = process.env[TOKEN]
  delete process.env[TOKEN]
  try {
    await assert.rejects(() => getPrivateObject('board-documents/seed/doc_0.pdf'), {
      message: `${TOKEN} is not set`,
    })
  } finally {
    if (before !== undefined) process.env[TOKEN] = before
  }
})
