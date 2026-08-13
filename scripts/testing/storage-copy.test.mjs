import { test } from 'node:test'
import assert from 'node:assert/strict'

const { planCopy } = await import('../storage/copy-to-blob.mjs')

test('Blob에 없으면 복사 대상', () => {
  const p = planCopy([{ path: 'artists/a.webp', size: 100 }], new Map())
  assert.deepEqual(p.toCopy, ['artists/a.webp'])
  assert.deepEqual(p.toSkip, [])
})

test('경로·크기가 같으면 건너뛴다', () => {
  const p = planCopy([{ path: 'artists/a.webp', size: 100 }], new Map([['artists/a.webp', 100]]))
  assert.deepEqual(p.toCopy, [])
  assert.deepEqual(p.toSkip, ['artists/a.webp'])
})

test('크기가 다르면 다시 복사한다', () => {
  const p = planCopy([{ path: 'artists/a.webp', size: 100 }], new Map([['artists/a.webp', 99]]))
  assert.deepEqual(p.toCopy, ['artists/a.webp'])
})

test('중첩 경로도 그대로 다룬다', () => {
  const p = planCopy([{ path: 'attachments/attachments/n.webp', size: 1 }], new Map())
  assert.deepEqual(p.toCopy, ['attachments/attachments/n.webp'])
})
