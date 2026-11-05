import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)
process.env.TURSO_DATABASE_URL ??= 'file:scripts/testing/.board-document-orphans.db'

/**
 * 이사회 서류 고아 청소(`sweepBoardDocumentOrphans`) — 브라우저 직접 업로드 뒤 등록하지 않은 객체, 승격 전에 끊긴 앱 편집
 * 저장본이 `board-documents/`에 영영 남던 결함. 행이 가리키지 않고 48시간 지난 객체만 지운다.
 *
 * 경로 대응: 객체 키에서 `board-documents/`를 떼어 행의 `file_path`(서류·버전)와 맞춘다. 시드 폴더는 늘 남긴다.
 */
const O = await import('../../src/lib/boardDocuments/orphans.ts')

const NOW = new Date('2026-11-05T00:00:00Z')
const hoursAgo = h => new Date(NOW.getTime() - h * 3600_000)
const U = '11111111-1111-4111-8111-111111111111'
const D = '33333333-3333-4333-8333-333333333333'
const V = i => `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`
const own = (n = 'a.pdf') => `board-documents/${U}/${n}`
const ver = (i, n = 'a.docx') => `board-documents/versions/${D}/${V(i)}/${n}`

/** 행이 가리키는 `file_path` 목록(접두 없음)으로 findReferenced 를 흉내 낸다 — 실제 쿼리처럼 받은 값을 그대로 돌려준다 */
const rowsReferencing =
  (...filePaths) =>
  async asked =>
    new Set(asked.filter(p => filePaths.includes(p)))

test('경로 대응: 접두를 떼고 봉쇄 판정을 지난 것만 후보 — 시드 폴더·접두 밖·규약 밖은 null', () => {
  assert.equal(O.boardDocumentOrphanCandidatePath(own('1_x_a.pdf')), `${U}/1_x_a.pdf`)
  assert.equal(O.boardDocumentOrphanCandidatePath(ver(1)), `versions/${D}/${V(1)}/a.docx`)
  assert.equal(O.boardDocumentOrphanCandidatePath('board-documents/seed/회의록.pdf'), null)
  assert.equal(O.boardDocumentOrphanCandidatePath('backups/db.sql'), null)
  assert.equal(O.boardDocumentOrphanCandidatePath('board-work/files/x'), null)
  assert.equal(O.boardDocumentOrphanCandidatePath('board-documents/../backups/x.sql'), null)
  assert.equal(O.boardDocumentOrphanCandidatePath('board-documents/not-a-uuid/a.pdf'), null)
  assert.equal(O.boardDocumentOrphanCandidatePath(`board-documents/versions/${D}/a.docx`), null)
  assert.equal(O.boardDocumentOrphanCandidatePath(`board-documents/${U}/sub/a.pdf`), null)
  assert.equal(O.boardDocumentOrphanCandidatePath(null), null)
})

test('행이 가리키는 객체(서류 지금 파일·v1 옛 경로·versions/ 경로)는 남기고 행 없는 것만 지운다', async () => {
  const objects = [
    { pathname: own('1_a_current.pdf'), uploadedAt: hoursAgo(100) }, // 서류 행 → 남김
    { pathname: own('2_b_v1old.pdf'), uploadedAt: hoursAgo(100) }, // 버전 행(v1 옛 경로)에만 → 남김
    { pathname: ver(1), uploadedAt: hoursAgo(100) }, // 버전 행(versions/) → 남김
    { pathname: ver(2), uploadedAt: hoursAgo(100) }, // 승격 전에 끊긴 저장본 → 지움
    { pathname: own('3_c_unregistered.pdf'), uploadedAt: hoursAgo(100) }, // 등록 안 한 업로드 → 지움
    { pathname: 'board-documents/seed/원본.pdf', uploadedAt: hoursAgo(10_000) }, // 시드 → 남김(묻지도 않는다)
  ]
  const asked = []
  const removed = []
  const res = await O.sweepBoardDocumentOrphans(NOW, {
    listPage: async () => ({ objects, cursor: null, hasMore: false }),
    findReferenced: async paths => {
      asked.push(...paths)
      return rowsReferencing(
        `${U}/1_a_current.pdf`,
        `${U}/2_b_v1old.pdf`,
        `versions/${D}/${V(1)}/a.docx`
      )(paths)
    },
    remove: async paths => {
      removed.push(...paths)
    },
  })
  assert.deepEqual(removed.sort(), [own('3_c_unregistered.pdf'), ver(2)].sort())
  assert.equal(res.removed, 2)
  assert.equal(res.scanned, 6)
  assert.equal(res.capped, false)
  assert.ok(
    asked.every(p => !p.startsWith('board-documents/')),
    '행과 맞출 때는 접두를 뗀 값으로 묻는다'
  )
  assert.ok(!asked.some(p => p.startsWith('seed/')), '시드 폴더는 묻지도 않는다')
})

test('행의 file_path 값(접두 없음) 그대로 가리키면 산 서류로 보고 남긴다', async () => {
  // findReferenced 가 접두 붙은 값을 받으면 아무것도 못 찾는다. 지금 구현은 뗀 값으로 묻기 때문에 남긴다.
  const removed = []
  await O.sweepBoardDocumentOrphans(NOW, {
    listPage: async () => ({
      objects: [{ pathname: own('9_live.pdf'), uploadedAt: hoursAgo(72) }],
      cursor: null,
      hasMore: false,
    }),
    findReferenced: rowsReferencing(`${U}/9_live.pdf`),
    remove: async paths => {
      removed.push(...paths)
    },
  })
  assert.deepEqual(removed, [])
})

test('48시간이 안 된 객체·시각을 모르는 객체는 행이 없어도 남긴다', async () => {
  const objects = [
    { pathname: own('young.pdf'), uploadedAt: hoursAgo(47) },
    { pathname: own('edge.pdf'), uploadedAt: hoursAgo(48) }, // 딱 48시간 — 아직 남긴다
    { pathname: own('nodate.pdf'), uploadedAt: new Date('x') },
    { pathname: own('old.pdf'), uploadedAt: hoursAgo(49) },
  ]
  const removed = []
  await O.sweepBoardDocumentOrphans(NOW, {
    listPage: async () => ({ objects, cursor: null, hasMore: false }),
    findReferenced: async () => new Set(),
    remove: async paths => {
      removed.push(...paths)
    },
  })
  assert.deepEqual(removed, [own('old.pdf')])
})

test('차단기: 고아로 보이는 것이 20개 이상이고 절반을 넘으면 하나도 지우지 않고 멈춘다', async () => {
  const objects = Array.from({ length: 30 }, (_, i) => ({
    pathname: ver(100 + i),
    uploadedAt: hoursAgo(80),
  }))
  const removed = []
  await assert.rejects(
    O.sweepBoardDocumentOrphans(NOW, {
      listPage: async () => ({ objects, cursor: null, hasMore: false }),
      findReferenced: async () => new Set(), // 빈 DB — 아무것도 안 가리킨다
      remove: async paths => {
        removed.push(...paths)
      },
    }),
    e => e.name === 'OrphanSweepAbortedError' && e.orphans === 30 && e.scanned === 30
  )
  assert.deepEqual(removed, [], '하나도 지우면 안 된다')
})

test('차단기: 고아가 20개 이상이어도 절반 이하면 지운다 · 절반을 넘어도 20개 미만이면 지운다', async () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    pathname: ver(200 + i),
    uploadedAt: hoursAgo(80),
  }))
  const live = many.slice(0, 25).map(o => o.pathname.slice('board-documents/'.length))
  let removed = 0
  await O.sweepBoardDocumentOrphans(NOW, {
    listPage: async () => ({ objects: many, cursor: null, hasMore: false }),
    findReferenced: rowsReferencing(...live),
    remove: async paths => {
      removed += paths.length
    },
  })
  assert.equal(removed, 25)

  const few = Array.from({ length: 19 }, (_, i) => ({
    pathname: ver(300 + i),
    uploadedAt: hoursAgo(80),
  }))
  removed = 0
  await O.sweepBoardDocumentOrphans(NOW, {
    listPage: async () => ({ objects: few, cursor: null, hasMore: false }),
    findReferenced: async () => new Set(),
    remove: async paths => {
      removed += paths.length
    },
  })
  assert.equal(removed, 19)
})

test('여러 페이지를 커서로 이어 훑는다', async () => {
  const pages = [
    {
      objects: [{ pathname: own('p1.pdf'), uploadedAt: hoursAgo(50) }],
      cursor: 'c1',
      hasMore: true,
    },
    {
      objects: [{ pathname: own('p2.pdf'), uploadedAt: hoursAgo(50) }],
      cursor: null,
      hasMore: false,
    },
  ]
  const cursors = []
  const removed = []
  const res = await O.sweepBoardDocumentOrphans(NOW, {
    listPage: async cursor => {
      cursors.push(cursor)
      return pages[cursors.length - 1]
    },
    findReferenced: async () => new Set(),
    remove: async paths => {
      removed.push(...paths)
    },
  })
  assert.deepEqual(cursors, [undefined, 'c1'])
  assert.deepEqual(removed, [own('p1.pdf'), own('p2.pdf')])
  assert.equal(res.capped, false)
})

test('쪽 수 상한(20)에 걸리면 멈추고 capped', async () => {
  let calls = 0
  const res = await O.sweepBoardDocumentOrphans(NOW, {
    listPage: async () => {
      calls++
      return { objects: [], cursor: `c${calls}`, hasMore: true }
    },
    findReferenced: async () => new Set(),
    remove: async () => {},
  })
  assert.equal(calls, 20)
  assert.equal(res.capped, true)
})

test('지우는 수 상한(500)에 걸리면 그 이상 지우지 않고 다음 페이지를 열지 않는다', async () => {
  // 한 페이지에 고아 19개씩(차단기 밑) — 쪽 상한과 지운 수 상한 중 먼저 걸리는 쪽에서 멈춘다
  let calls = 0
  let removed = 0
  const res = await O.sweepBoardDocumentOrphans(NOW, {
    listPage: async () => {
      calls++
      const objects = Array.from({ length: 19 }, (_, i) => ({
        pathname: own(`c${calls}_${i}.pdf`),
        uploadedAt: hoursAgo(80),
      }))
      return { objects, cursor: `c${calls}`, hasMore: true }
    },
    findReferenced: async () => new Set(),
    remove: async paths => {
      removed += paths.length
    },
  })
  // 쪽 상한(20) × 19 = 380 < 500 이므로 쪽 상한이 먼저 — 지운 수 상한은 아래에서 따로 본다
  assert.equal(removed, 380)
  assert.equal(res.capped, true)

  // 한 페이지에 고아 600개 + 가리키는 행 700개(절반 이하) → 500개만 지우고 멈춘다
  const objs = Array.from({ length: 1300 }, (_, i) => ({
    pathname: own(`big_${i}.pdf`),
    uploadedAt: hoursAgo(80),
  }))
  const live = objs.slice(600).map(o => o.pathname.slice('board-documents/'.length))
  let pages = 0
  removed = 0
  const res2 = await O.sweepBoardDocumentOrphans(NOW, {
    listPage: async () => {
      pages++
      return { objects: objs, cursor: 'more', hasMore: true }
    },
    findReferenced: rowsReferencing(...live),
    remove: async paths => {
      removed += paths.length
    },
  })
  assert.equal(removed, 500)
  assert.equal(pages, 1)
  assert.equal(res2.capped, true)
})

test('시간 예산(30초)을 넘기면 새 페이지를 시작하지 않는다', async () => {
  let t = 0
  let calls = 0
  const res = await O.sweepBoardDocumentOrphans(NOW, {
    clock: () => t,
    listPage: async () => {
      calls++
      t += 40_000
      return { objects: [], cursor: 'next', hasMore: true }
    },
    findReferenced: async () => new Set(),
    remove: async () => {},
  })
  assert.equal(calls, 1)
  assert.equal(res.capped, true)
})
