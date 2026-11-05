import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)
process.env.TURSO_DATABASE_URL ??= 'file:scripts/testing/.member-document-orphans.db'

/**
 * 내 문서함 고아 청소(`sweepMemberDocumentOrphans`) — 보존 삭제·탈퇴·폐기가 행을 먼저 지운 뒤 객체 삭제가 실패하면 개인 파일이
 * 영영 남았다(2026-11-05 회귀 리뷰). 행이 가리키지 않고 48시간이 지난 `member-documents/` 객체만 지운다.
 */
const R = await import('../../src/lib/memberDocuments/retention.ts')

const NOW = new Date('2026-11-05T00:00:00Z')
const hoursAgo = h => new Date(NOW.getTime() - h * 3600_000)
const U = '11111111-1111-4111-8111-111111111111'
const path = (v, n = 'a.docx') => `member-documents/${U}/${v}/${n}`
const V = i => `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`

test('행이 없고 48시간 지난 객체만 지운다 — 최근 객체·행이 가리키는 객체·규약 밖 경로는 남긴다', async () => {
  const objects = [
    { pathname: path(V(1)), uploadedAt: hoursAgo(72) }, // 고아 → 지움
    { pathname: path(V(2)), uploadedAt: hoursAgo(72) }, // 행 있음 → 남김
    { pathname: path(V(3)), uploadedAt: hoursAgo(2) }, // 올린 지 얼마 안 됨 → 남김
    { pathname: 'member-documents/../backups/x.sql', uploadedAt: hoursAgo(99) }, // 규약 밖 → 남김
  ]
  const removed = []
  const n = await R.sweepMemberDocumentOrphans(NOW, {
    listPage: async () => ({ objects, cursor: null, hasMore: false }),
    findReferenced: async paths => new Set(paths.filter(p => p === path(V(2)))),
    remove: async paths => {
      removed.push(...paths)
    },
  })
  assert.equal(n, 1)
  assert.deepEqual(removed, [path(V(1))])
})

test('여러 페이지를 이어 훑는다', async () => {
  const pages = [
    { objects: [{ pathname: path(V(10)), uploadedAt: hoursAgo(50) }], cursor: 'c1', hasMore: true },
    {
      objects: [{ pathname: path(V(11)), uploadedAt: hoursAgo(50) }],
      cursor: null,
      hasMore: false,
    },
  ]
  const removed = []
  let call = 0
  await R.sweepMemberDocumentOrphans(NOW, {
    listPage: async () => pages[call++],
    findReferenced: async () => new Set(),
    remove: async paths => {
      removed.push(...paths)
    },
  })
  assert.deepEqual(removed, [path(V(10)), path(V(11))])
})
