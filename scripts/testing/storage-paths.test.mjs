import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://btugywkltavbogdnhwpu.supabase.co'
process.env.BLOB_PUBLIC_BASE_URL = 'https://examplestore.public.blob.vercel-storage.com'

const { currentProvider, splitBucketPath, logicalPathFromUrl } = await import(
  '../../src/lib/storage/paths.ts'
)

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
