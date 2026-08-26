import { test } from 'node:test'
import assert from 'node:assert/strict'

const { hasPublicBlobStore, putObject } = await import('../../src/lib/storage/blob.ts')

// 업로드·삭제 라우트의 사전 검증 문지기. 토큰이 없으면 put/del이 던지는데,
// 그 예외를 로그만 남기고 삼키는 호출부(아티스트 사진 DELETE 등)가 있어서
// 확인 없이 진행하면 "아무것도 안 지웠는데 200"이 나간다. 이 판정이 그
// 무음 성공을 500으로 바꾼다.
//
// 단계 4 Task 5 이전에는 같은 파일이 `hasPrivateBlobStore`(교차 제공자 폴백
// 문지기)를 고정했다. Supabase Storage 폴백 자체가 사라지면서 그 함수도 함께
// 없앴다 — 비공개 저장소는 이제 유일한 제공자라 미설정이면 조용히 넘어가지
// 않고 그대로 던져야 한다.

const TOKEN = 'PUBLIC_BLOB_READ_WRITE_TOKEN'

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
  withToken(undefined, () => assert.equal(hasPublicBlobStore(), false))
})

test('빈 문자열과 공백만 있는 값도 미설정으로 본다', () => {
  // requireEnv는 빈 문자열만 걸러낸다. 환경변수 편집 실수로 개행 하나가 들어간
  // 값이 "설정됨"으로 잡히면 사전 검증이 통과해 버리므로 trim 기준을 쓴다.
  withToken('', () => assert.equal(hasPublicBlobStore(), false))
  withToken('   ', () => assert.equal(hasPublicBlobStore(), false))
  withToken('\n\t', () => assert.equal(hasPublicBlobStore(), false))
})

test('값이 있으면 설정된 것으로 본다', () => {
  withToken('vercel_blob_rw_example', () => assert.equal(hasPublicBlobStore(), true))
})

test('미설정 상태에서 putObject는 조용히 실패하지 않고 던진다 (판정이 필요한 이유)', async () => {
  const before = process.env[TOKEN]
  delete process.env[TOKEN]
  try {
    await assert.rejects(
      () => putObject('public', 'attachments/probe.txt', Buffer.from('x'), 'text/plain'),
      { message: `${TOKEN} is not set` }
    )
  } finally {
    if (before !== undefined) process.env[TOKEN] = before
  }
})
