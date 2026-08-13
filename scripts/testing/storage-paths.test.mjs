import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://btugywkltavbogdnhwpu.supabase.co'
process.env.BLOB_PUBLIC_BASE_URL = 'https://examplestore.public.blob.vercel-storage.com'

const { currentProvider, splitBucketPath, logicalPathFromUrl, classifyDeleteEverywhereResults } =
  await import('../../src/lib/storage/paths.ts')

function fulfilled(provider) {
  return { provider, result: { status: 'fulfilled', value: undefined } }
}

function rejected(provider, reason) {
  return { provider, result: { status: 'rejected', reason } }
}

test('STORAGE_PROVIDER 미설정이면 supabase', () => {
  delete process.env.STORAGE_PROVIDER
  assert.equal(currentProvider(), 'supabase')
})

test('blob일 때만 blob, 알 수 없는 값은 supabase', () => {
  process.env.STORAGE_PROVIDER = 'blob'
  assert.equal(currentProvider(), 'blob')
  process.env.STORAGE_PROVIDER = 'r2'
  assert.equal(currentProvider(), 'supabase')
  delete process.env.STORAGE_PROVIDER
})

test('논리 경로를 버킷과 키로 나눈다', () => {
  assert.deepEqual(splitBucketPath('attachments/2026/a.webp'), {
    bucket: 'attachments',
    key: '2026/a.webp',
  })
  assert.deepEqual(splitBucketPath('attachments/attachments/nested.webp'), {
    bucket: 'attachments',
    key: 'attachments/nested.webp',
  })
})

test('잘못된 경로를 거부한다', () => {
  for (const bad of ['', 'attachments', 'attachments/', '/attachments/a', 'a//b', 'x/../y']) {
    assert.throws(() => splitBucketPath(bad), /pathname/, `허용되면 안 됨: ${bad}`)
  }
})

test('Supabase URL에서 논리 경로를 복원한다', () => {
  assert.equal(
    logicalPathFromUrl(
      'https://btugywkltavbogdnhwpu.supabase.co/storage/v1/object/public/attachments/posts/p1/a.webp',
      'attachments',
      'posts/p1'
    ),
    'attachments/posts/p1/a.webp'
  )
})

test('Blob URL에서 논리 경로를 복원한다', () => {
  assert.equal(
    logicalPathFromUrl(
      'https://examplestore.public.blob.vercel-storage.com/attachments/posts/p1/a.webp',
      'attachments',
      'posts/p1'
    ),
    'attachments/posts/p1/a.webp'
  )
})

test('버킷이 다르면 거부한다', () => {
  assert.equal(
    logicalPathFromUrl(
      'https://examplestore.public.blob.vercel-storage.com/artists/artist-001/p.webp',
      'attachments'
    ),
    null
  )
})

test('접두사가 다르면 거부한다', () => {
  assert.equal(
    logicalPathFromUrl(
      'https://examplestore.public.blob.vercel-storage.com/attachments/posts/OTHER/a.webp',
      'attachments',
      'posts/p1'
    ),
    null
  )
})

test('알 수 없는 호스트는 거부한다', () => {
  assert.equal(
    logicalPathFromUrl('https://evil.example.com/attachments/a.webp', 'attachments'),
    null
  )
  assert.equal(logicalPathFromUrl('', 'attachments'), null)
})

test('everywhere 삭제: 리젝트가 없으면 로그도 throw도 없다', () => {
  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    fulfilled('blob'),
    fulfilled('supabase'),
  ])
  assert.deepEqual(toLog, [])
  assert.equal(shouldThrow, false)
})

test('everywhere 삭제: 한쪽만 실패하면 로그에는 남지만 throw하지 않는다', () => {
  const reason = new Error('network timeout')
  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    rejected('blob', reason),
    fulfilled('supabase'),
  ])
  assert.deepEqual(toLog, [{ provider: 'blob', reason }])
  assert.equal(shouldThrow, false)
})

test('everywhere 삭제: 둘 다 실패하면 둘 다 로그되고 throw한다', () => {
  const blobReason = new Error('unauthorized')
  const supabaseReason = new Error('network error')
  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    rejected('blob', blobReason),
    rejected('supabase', supabaseReason),
  ])
  assert.deepEqual(toLog, [
    { provider: 'blob', reason: blobReason },
    { provider: 'supabase', reason: supabaseReason },
  ])
  assert.equal(shouldThrow, true)
})

test('everywhere 삭제: "does not exist" 메시지도 진짜 실패로 친다 (회귀 테스트)', () => {
  // BlobStoreNotFoundError의 실제 메시지. 예전 정규식(/not.?found|does not exist/i)은
  // 이 문자열을 "없는 객체"로 오인해 조용히 삼켰다 — 잘못된 토큰/스토어 설정이라는
  // 진짜 실패였는데도. 메시지로 거르지 않는 지금은 둘 다 실패로 잡혀 throw해야 한다.
  const blobReason = new Error('This store does not exist.')
  const supabaseReason = new Error('network error')
  const { toLog, shouldThrow } = classifyDeleteEverywhereResults([
    rejected('blob', blobReason),
    rejected('supabase', supabaseReason),
  ])
  assert.deepEqual(toLog, [
    { provider: 'blob', reason: blobReason },
    { provider: 'supabase', reason: supabaseReason },
  ])
  assert.equal(shouldThrow, true)
})
