import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * 이사회 업무툴 크론(5단계) 순수 규칙 — 원본 kosmart-work `lib/cron.ts`·`lib/ops/cron-schedule.ts`·
 * `/api/internal/purge-pending-uploads`·`lib/files/pending-orphans.ts`·`lib/digest/cleanup.ts`.
 *
 * 가장 중요한 단정: 정리 크론이 지우는 키는 **`board-work/` 밖으로 절대 나가지 않는다** — 같은 비공개 저장소에
 * DB 백업(`backups/`)·메일 첨부(`mailbox/`)·이사회 서류(`board-documents/`)가 있다. 고아 정리는 가짜 목록·가짜 삭제로 본다.
 */

const { isCronAuthorized, isCronSecretConfigured } = await import(
  '../../src/work/lib/ops/cron-auth.ts'
)
const {
  CRON_EXPECTED_MINUTES,
  BOARD_WORK_CRON_PREFIX,
  WATCHDOG_JOB,
  findCronProblems,
  intervalMinutesOf,
} = await import('../../src/work/lib/ops/cron-schedule.ts')
const {
  pendingObjectPaths,
  purgeObjectPaths,
  removeRenderCachesWith,
  renderCachePathsFor,
  renderPrefixOf,
  sweepOrphanObjects,
  ORPHAN_SCAN_PREFIX,
} = await import('../../src/work/lib/files/cleanup-plan.ts')

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'

// ── 인증 ─────────────────────────────────────────────────────────────────────

test('크론 인증: 정확한 Bearer만 통과, 시크릿이 없으면 무엇이든 거부(fail-closed)', () => {
  assert.equal(isCronAuthorized('Bearer s3cret', 's3cret'), true)
  assert.equal(isCronAuthorized('Bearer s3cre', 's3cret'), false)
  assert.equal(isCronAuthorized('Bearer s3cretX', 's3cret'), false)
  assert.equal(isCronAuthorized('bearer s3cret', 's3cret'), false)
  assert.equal(isCronAuthorized('s3cret', 's3cret'), false)
  assert.equal(isCronAuthorized(null, 's3cret'), false)
  assert.equal(isCronAuthorized('Bearer ', ''), false)
  assert.equal(isCronAuthorized('Bearer undefined', undefined), false)
  assert.equal(isCronSecretConfigured(''), false)
  assert.equal(isCronSecretConfigured('x'), true)
})

test('크론 라우트는 전부 withBoardWorkCron(인증 먼저)으로 감싸고 GET을 내보낸다', () => {
  const dir = 'src/app/api/internal/board-work'
  const jobs = readdirSync(dir)
  assert.deepEqual(jobs.sort(), Object.keys(CRON_EXPECTED_MINUTES).sort())
  for (const job of jobs) {
    const src = readFileSync(`${dir}/${job}/route.ts`, 'utf8')
    assert.match(src, new RegExp(`withBoardWorkCron\\('${job}', handle\\)`), job)
    assert.match(src, /export const GET = guarded/, job)
    // 핸들러 밖에서 DB·저장소를 건드리는 다른 export가 없다
    assert.equal((src.match(/^export (async )?function/gm) ?? []).length, 0, job)
  }
})

// ── 스케줄 표 ─────────────────────────────────────────────────────────────────

test('vercel.json 업무툴 크론과 기대 주기 표가 같다', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const mine = vercel.crons.filter(c => c.path.startsWith(BOARD_WORK_CRON_PREFIX))
  const scheduled = Object.fromEntries(
    mine.map(c => [c.path.slice(BOARD_WORK_CRON_PREFIX.length), intervalMinutesOf(c.schedule)])
  )
  for (const [job, minutes] of Object.entries(CRON_EXPECTED_MINUTES)) {
    assert.equal(scheduled[job], minutes, job)
  }
  assert.equal(scheduled['mention-digest'], 60)
  assert.equal(mine.length, Object.keys(CRON_EXPECTED_MINUTES).length)
})

test('크론 감시: 멈춤(running 방치)·지연(주기 2배)·정상 — 감시 크론 자신과 기록 없는 크론은 판정하지 않는다', () => {
  const now = new Date('2026-11-04T03:00:00Z')
  const ago = m => new Date(now.getTime() - m * 60_000).toISOString()
  const problems = findCronProblems(
    [
      {
        job: 'purge-deleted',
        last_started_at: ago(30),
        last_succeeded_at: ago(1500),
        last_status: 'running',
      },
      {
        job: 'push-cleanup',
        last_started_at: ago(3000),
        last_succeeded_at: ago(3000),
        last_status: 'ok',
      },
      {
        job: 'purge-pending-uploads',
        last_started_at: ago(60),
        last_succeeded_at: ago(60),
        last_status: 'ok',
      },
      {
        job: WATCHDOG_JOB,
        last_started_at: ago(9999),
        last_succeeded_at: ago(9999),
        last_status: 'failed',
      },
    ],
    now
  )
  assert.deepEqual(
    problems.map(p => [p.job, p.kind]),
    [
      ['purge-deleted', 'stuck'],
      ['push-cleanup', 'stale'],
    ]
  )
})

// ── 지울 키 계산 ──────────────────────────────────────────────────────────────

const OUTSIDE = [
  'backups/2026-11-01.sql.gz',
  'mailbox/abc/attachment.pdf',
  'board-documents/x.pdf',
  'board-work-evil/files/x/y',
  `board-work/files/${U1}/../../backups/db.sql`,
  `board-work/files/not-a-uuid/a.pdf`,
  'board-work/other/a.pdf',
  `/board-work/files/${U1}/a.pdf`,
  `board-work/files/${U1}/a%2e%2e.pdf`,
]

test('임시 업로드 정리: board-work 밖·규약 밖 경로는 키 목록에 들어가지 않고 unsafe로 센다', () => {
  const rows = [
    { id: U1, blobPath: `board-work/files/${U1}/report.hwp`, isDraft: false },
    ...OUTSIDE.map(p => ({ id: U2, blobPath: p, isDraft: false })),
  ]
  const plan = pendingObjectPaths(rows, () => [])
  assert.deepEqual(plan.paths, [`board-work/files/${U1}/report.hwp`])
  assert.equal(plan.unsafe, OUTSIDE.length)
  for (const p of plan.paths) assert.ok(p.startsWith('board-work/'))
})

test('임시 업로드 정리: 문서 편집 초안이면 미리보기 캐시도 함께(그것도 board-work만)', () => {
  const plan = pendingObjectPaths(
    [{ id: U1, blobPath: `board-work/files/${U1}/draft.docx`, isDraft: true }],
    id => [
      `board-work/renders/${id}-draft-layout.json`,
      `board-work/renders/${id}-draft-layout-p1.svg`,
      'backups/sneaky.sql',
    ]
  )
  assert.deepEqual(plan.paths, [
    `board-work/files/${U1}/draft.docx`,
    `board-work/renders/${U1}-draft-layout.json`,
    `board-work/renders/${U1}-draft-layout-p1.svg`,
  ])
  assert.equal(plan.unsafe, 1)
})

test('삭제 메시지 정리: 첨부 원본 + 썸네일, 경로가 이상한 첨부는 객체를 건드리지 않는다', () => {
  const plan = purgeObjectPaths([
    { id: U1, blobPath: `board-work/files/${U1}/photo.png` },
    { id: U2, blobPath: 'mailbox/x/secret.pdf' },
    { id: U3, blobPath: 'backups/db.sql' },
  ])
  assert.deepEqual(plan.paths, [
    `board-work/files/${U1}/photo.png`,
    `board-work/files/${U1}/photo.png.thumb.webp`,
  ])
  assert.equal(plan.unsafe, 2)
  assert.deepEqual(plan.attachmentIds.sort(), [U1, U2, U3].sort())
})

test('미리보기 캐시: 접두는 board-work/renders/<id>- 이고, 목록에서 그 첨부 것만 고른다', () => {
  assert.equal(renderPrefixOf(U1.toUpperCase()), `board-work/renders/${U1}-`)
  const listed = [
    `board-work/renders/${U1}-v3.json`,
    `board-work/renders/${U1}-L2-layout-p2.svg`,
    `board-work/renders/${U2}-v3.json`,
    `board-work/renders/${U1}-v3.txt`,
    'backups/whatever.json',
  ]
  assert.deepEqual(renderCachePathsFor(U1, listed), [
    `board-work/renders/${U1}-v3.json`,
    `board-work/renders/${U1}-L2-layout-p2.svg`,
  ])
})

test('이사회 서류 미리보기 캐시: 그 서류 id 의 board-work/renders/ 키만 지우고 다른 접두·다른 id 는 건드리지 않는다', async () => {
  const DOC = '44444444-4444-4444-8444-444444444444'
  // 목록이 접두를 무시하고 섞어 돌려줘도(저장소 오동작·가짜) 고르는 쪽이 거른다
  const listed = [
    `board-work/renders/${DOC}-v3.json`,
    `board-work/renders/${DOC}-L2-layout.json`,
    `board-work/renders/${DOC}-L2-layout-p1.svg`,
    `board-work/renders/${DOC}-L2-layout-p9-big.json`,
    `board-work/renders/${DOC.toUpperCase()}-v3.json`,
    `board-work/renders/${U1}-v3.json`,
    `board-work/renders/${DOC.slice(0, -1)}5-v3.json`,
    `board-work/renders/x${DOC}-v3.json`,
    `board-work/renders/sub/${DOC}-v3.json`,
    `board-work/renders/${DOC}-v3.txt`,
    `board-work/renders/${DOC}-..json`,
    `board-work/files/${DOC}/원본.docx`,
    `board-documents/${U2}/${DOC}-v3.json`,
    `backups/${DOC}-v3.json`,
    `mailbox/${DOC}-v3.json`,
  ]
  const removed = []
  const prefixes = []
  const n = await removeRenderCachesWith([DOC], {
    listPage: async (prefix, cursor) => {
      prefixes.push(prefix)
      return cursor
        ? { objects: listed.slice(8).map(pathname => ({ pathname })), cursor: null, hasMore: false }
        : {
            objects: listed.slice(0, 8).map(pathname => ({ pathname })),
            cursor: 'c2',
            hasMore: true,
          }
    },
    remove: async paths => {
      removed.push(...paths)
    },
  })
  assert.deepEqual(prefixes, [`board-work/renders/${DOC}-`, `board-work/renders/${DOC}-`])
  assert.deepEqual(
    removed.sort(),
    [
      `board-work/renders/${DOC.toUpperCase()}-v3.json`,
      `board-work/renders/${DOC}-L2-layout-p1.svg`,
      `board-work/renders/${DOC}-L2-layout-p9-big.json`,
      `board-work/renders/${DOC}-L2-layout.json`,
      `board-work/renders/${DOC}-v3.json`,
    ].sort()
  )
  assert.equal(n, 5)
  for (const p of removed) {
    assert.ok(p.startsWith('board-work/renders/'), p)
    assert.ok(p.slice('board-work/renders/'.length).toLowerCase().startsWith(`${DOC}-`), p)
  }
})

test('미리보기 캐시 정리: 목록·지우기가 실패해도 던지지 않고 onError 로 알린다(다음 id 는 계속)', async () => {
  const errors = []
  const removed = []
  const n = await removeRenderCachesWith([U1, U2], {
    listPage: async prefix => {
      if (prefix.includes(U1)) throw new Error('store down')
      return {
        objects: [{ pathname: `board-work/renders/${U2}-v3.json` }],
        cursor: null,
        hasMore: false,
      }
    },
    remove: async paths => {
      removed.push(...paths)
    },
    onError: (id, e) => errors.push([id, e.message]),
  })
  assert.deepEqual(errors, [[U1, 'store down']])
  assert.deepEqual(removed, [`board-work/renders/${U2}-v3.json`])
  assert.equal(n, 1)
  const none = await removeRenderCachesWith([U3], {
    listPage: async () => ({ objects: [], cursor: null, hasMore: false }),
    remove: async () => {
      throw new Error('remove must not be called with nothing')
    },
  })
  assert.equal(none, 0)
})

// ── 고아 객체(가짜 목록) ──────────────────────────────────────────────────────

const NOW = new Date('2026-11-04T03:00:00Z')
const DAY = 24 * 3600 * 1000
const old = (h = 30) => new Date(NOW.getTime() - h * 3600 * 1000)

function fakeStore(pages) {
  const removed = []
  let listed = 0
  return {
    removed,
    get listed() {
      return listed
    },
    listPage: async cursor => {
      const i = cursor ? Number(cursor) : 0
      listed++
      return {
        objects: pages[i],
        cursor: i + 1 < pages.length ? String(i + 1) : null,
        hasMore: i + 1 < pages.length,
      }
    },
    remove: async paths => {
      removed.push(...paths)
    },
  }
}

test('고아 정리: 행 없는 24시간 지난 board-work/files 객체만 지운다(썸네일은 원본 행이 있으면 남긴다)', async () => {
  const referenced = new Set([
    `board-work/files/${U1}/kept.pdf`,
    `board-work/files/${U3}/img.png`,
    // 사용자가 올린 진짜 파일 이름이 .thumb.webp로 끝나는 경우 — 자기 키가 행에 있다
    `board-work/files/${U2}/real.thumb.webp`,
  ])
  const store = fakeStore([
    [
      { pathname: `board-work/files/${U1}/kept.pdf`, uploadedAt: old() },
      { pathname: `board-work/files/${U2}/orphan.pdf`, uploadedAt: old() },
      { pathname: `board-work/files/${U3}/img.png.thumb.webp`, uploadedAt: old() },
      { pathname: `board-work/files/${U2}/real.thumb.webp`, uploadedAt: old() },
    ],
    [
      // 아직 24시간 안(업로드 중일 수 있다)
      { pathname: `board-work/files/${U1}/fresh.pdf`, uploadedAt: old(2) },
      // 원본 행이 없는 썸네일 → 고아
      { pathname: `board-work/files/${U2}/gone.png.thumb.webp`, uploadedAt: old() },
      // 목록 함수가 실수로 넘긴 밖의 키 — 절대 지우지 않는다
      { pathname: 'backups/2026-11-01.sql.gz', uploadedAt: old(999) },
      { pathname: `board-work/renders/${U1}-v1.json`, uploadedAt: old(999) },
      { pathname: `board-work/files/${U1}/../../backups/x`, uploadedAt: old(999) },
    ],
  ])
  const asked = []
  const out = await sweepOrphanObjects({
    listPage: store.listPage,
    findReferenced: async paths => {
      asked.push(...paths)
      return new Set(paths.filter(p => referenced.has(p)))
    },
    remove: store.remove,
    now: NOW,
    retentionMs: DAY,
  })
  assert.deepEqual(store.removed.sort(), [
    `board-work/files/${U2}/gone.png.thumb.webp`,
    `board-work/files/${U2}/orphan.pdf`,
  ])
  assert.equal(out.removed, 2)
  assert.equal(out.scanned, 9)
  assert.equal(out.capped, false)
  for (const p of store.removed) {
    assert.ok(p.startsWith(ORPHAN_SCAN_PREFIX), p)
  }
  // 밖의 키는 행 조회에도 들어가지 않는다
  assert.equal(
    asked.some(p => !p.startsWith('board-work/files/')),
    false
  )
})

test('고아 정리: 지우는 수 상한에서 멈추고 capped를 알린다(남은 것은 다음 실행)', async () => {
  const objs = Array.from({ length: 5 }, (_, i) => ({
    pathname: `board-work/files/${U1}/f${i}.pdf`,
    uploadedAt: old(),
  }))
  const store = fakeStore([objs, objs])
  const out = await sweepOrphanObjects({
    listPage: store.listPage,
    findReferenced: async () => new Set(),
    remove: store.remove,
    now: NOW,
    retentionMs: DAY,
    maxRemovals: 3,
  })
  assert.equal(out.removed, 3)
  assert.equal(store.removed.length, 3)
  assert.equal(out.capped, true)
})

test('고아 정리: 행 조회가 실패하면 아무것도 지우지 않고 던진다', async () => {
  const store = fakeStore([[{ pathname: `board-work/files/${U1}/a.pdf`, uploadedAt: old() }]])
  await assert.rejects(() =>
    sweepOrphanObjects({
      listPage: store.listPage,
      findReferenced: async () => {
        throw new Error('db down')
      },
      remove: store.remove,
      now: NOW,
      retentionMs: DAY,
    })
  )
  assert.equal(store.removed.length, 0)
})
