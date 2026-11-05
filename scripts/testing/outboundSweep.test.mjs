import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/lib/mail/outboundSweep.ts` — 보낸 메일의 보관 기한과 고아 Blob 정리.
 * 실제 SQLite 파일 DB와 **가짜 Blob 저장소**로 검증한다(운영 저장소를 건드리지 않는다).
 */

const DB_PATH = 'scripts/testing/.outbound-sweep-test.db'
const DAY = 24 * 60 * 60 * 1000

let setup
before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
  setup = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setup)
})
after(() => {
  setup?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const mod = () => import(`../../src/lib/mail/outboundSweep.ts?t=${Date.now()}-${Math.random()}`)

/** 상태·나이를 지정해 행을 심는다(created_at을 과거로). */
async function plant({ status, ageDays, updatedDaysAgo = ageDays, attachment = true }) {
  const id = crypto.randomUUID()
  const created = Date.now() - ageDays * DAY
  const updated = Date.now() - updatedDaysAgo * DAY
  await setup.execute({
    sql: `INSERT INTO outbound_emails
      (id, idempotency_key, to_addresses, recipient_count, subject, body_html, status, created_at, updated_at)
      VALUES (?, ?, '["a@example.com"]', 1, 's', '<p>x</p>', ?, ?, ?)`,
    args: [id, `k-${id}`, status, created, updated],
  })
  let path = null
  if (attachment) {
    const attId = crypto.randomUUID()
    path = `mailbox-sent/${id}/${attId}.pdf`
    await setup.execute({
      sql: `INSERT INTO outbound_email_attachments (id, email_id, filename, size_bytes, blob_path)
        VALUES (?, ?, 'a.pdf', 10, ?)`,
      args: [attId, id, path],
    })
  }
  return { id, path }
}

async function exists(id) {
  const r = await setup.execute({ sql: 'SELECT 1 FROM outbound_emails WHERE id = ?', args: [id] })
  return r.rows.length > 0
}
async function attachmentRows(id) {
  const r = await setup.execute({
    sql: 'SELECT 1 FROM outbound_email_attachments WHERE email_id = ?',
    args: [id],
  })
  return r.rows.length
}

function fakeBlob({ listed = [], failOn = new Set() } = {}) {
  const removed = []
  return {
    removed,
    list: async () => listed,
    remove: async p => {
      if (failOn.has(p)) throw new Error('blob down')
      removed.push(p)
    },
  }
}

const CONFIG = { failedRetentionDays: 30, sentRetentionDays: null }

// ── 설정 ─────────────────────────────────────────────────────────────────────

test('설정: 실패 보관 기본 30일, 나간 메일은 기본으로 지우지 않는다', async () => {
  const { sweepConfigFromEnv } = await mod()
  assert.deepEqual(sweepConfigFromEnv({}), { failedRetentionDays: 30, sentRetentionDays: null })
  assert.deepEqual(
    sweepConfigFromEnv({
      MAILBOX_OUTBOUND_FAILED_RETENTION_DAYS: '14',
      MAILBOX_OUTBOUND_RETENTION_DAYS: '365',
    }),
    { failedRetentionDays: 14, sentRetentionDays: 365 }
  )
})

test('설정: 잘못된 값은 기본으로, 너무 짧은 값은 최소 7일로 올린다 — 실수로 바로 지우지 않게', async () => {
  const { sweepConfigFromEnv } = await mod()
  for (const bad of ['abc', '-5', '0', '1.5', '']) {
    assert.deepEqual(
      sweepConfigFromEnv({
        MAILBOX_OUTBOUND_FAILED_RETENTION_DAYS: bad,
        MAILBOX_OUTBOUND_RETENTION_DAYS: bad,
      }),
      { failedRetentionDays: 30, sentRetentionDays: null },
      JSON.stringify(bad)
    )
  }
  const tiny = sweepConfigFromEnv({
    MAILBOX_OUTBOUND_FAILED_RETENTION_DAYS: '1',
    MAILBOX_OUTBOUND_RETENTION_DAYS: '2',
  })
  assert.equal(tiny.failedRetentionDays, 7)
  assert.equal(tiny.sentRetentionDays, 7)
})

// ── 보관 기한 ────────────────────────────────────────────────────────────────

test('오래된 failed·blocked는 행과 첨부(Blob 포함)를 지우고 최근 것은 남긴다', async () => {
  const { sweepOutbound } = await mod()
  const oldFailed = await plant({ status: 'failed', ageDays: 31 })
  const oldBlocked = await plant({ status: 'blocked', ageDays: 45, attachment: false })
  const recentFailed = await plant({ status: 'failed', ageDays: 5 })
  const blob = fakeBlob()

  const result = await sweepOutbound(Date.now(), CONFIG, blob)

  assert.equal(await exists(oldFailed.id), false)
  assert.equal(await exists(oldBlocked.id), false)
  assert.equal(await attachmentRows(oldFailed.id), 0)
  assert.ok(blob.removed.includes(oldFailed.path))
  assert.equal(await exists(recentFailed.id), true, '최근 실패는 남긴다')
  assert.equal(await attachmentRows(recentFailed.id), 1)
  assert.ok(!blob.removed.includes(recentFailed.path))
  assert.ok(result.purgedRows >= 2)
})

test('unknown·sending은 아무리 오래돼도 지우지 않는다 — 사람이 확인해야 하는 행', async () => {
  const { sweepOutbound } = await mod()
  const unknown = await plant({ status: 'unknown', ageDays: 400 })
  const sending = await plant({ status: 'sending', ageDays: 400 })
  const blob = fakeBlob()

  await sweepOutbound(Date.now(), { failedRetentionDays: 7, sentRetentionDays: 7 }, blob)

  assert.equal(await exists(unknown.id), true)
  assert.equal(await exists(sending.id), true)
  assert.ok(!blob.removed.includes(unknown.path))
  assert.ok(!blob.removed.includes(sending.path))
})

test('나간 메일(sent)은 기본으로 지우지 않고, 보관 기한을 정했을 때만 지운다', async () => {
  const { sweepOutbound } = await mod()
  const sent = await plant({ status: 'sent', ageDays: 500 })
  const blob = fakeBlob()

  await sweepOutbound(Date.now(), CONFIG, blob)
  assert.equal(await exists(sent.id), true, '기본은 보관')
  assert.equal(await attachmentRows(sent.id), 1)

  await sweepOutbound(Date.now(), { failedRetentionDays: 30, sentRetentionDays: 365 }, blob)
  assert.equal(await exists(sent.id), false)
  assert.equal(await attachmentRows(sent.id), 0)
  assert.ok(blob.removed.includes(sent.path))
})

test('기한 안의 sent는 보관 기한을 정해도 남긴다', async () => {
  const { sweepOutbound } = await mod()
  const recentSent = await plant({ status: 'sent', ageDays: 100 })
  await sweepOutbound(Date.now(), { failedRetentionDays: 30, sentRetentionDays: 365 }, fakeBlob())
  assert.equal(await exists(recentSent.id), true)
})

test('Blob 삭제가 실패해도 행은 지운다 — 파일은 고아가 되어 나중에 치워진다', async () => {
  const { sweepOutbound } = await mod()
  const row = await plant({ status: 'failed', ageDays: 60 })
  const blob = fakeBlob({ failOn: new Set([row.path]) })

  const result = await sweepOutbound(Date.now(), CONFIG, blob)

  assert.equal(await exists(row.id), false)
  assert.ok(result.blobDeleteFailures >= 1)
})

test('기한은 상태가 정해진 시각(updated_at) 기준이다 — 오래된 unknown을 방금 확정해도 바로 지워지지 않는다', async () => {
  const { sweepOutbound } = await mod()
  // 90일 전에 만들어져 unknown으로 남아 있다가 어제 운영자가 "안 나갔음"으로 확정한 행.
  const justResolved = await plant({ status: 'failed', ageDays: 90, updatedDaysAgo: 1 })
  // 같은 90일 전 행이지만 40일 전에 확정됐다 — 30일 기한을 넘겼다.
  const resolvedLongAgo = await plant({ status: 'failed', ageDays: 90, updatedDaysAgo: 40 })
  const blob = fakeBlob()

  await sweepOutbound(Date.now(), CONFIG, blob)

  assert.equal(
    await exists(justResolved.id),
    true,
    'created_at 기준이면 어제 확정한 행이 바로 지워진다'
  )
  assert.equal(await attachmentRows(justResolved.id), 1)
  assert.ok(!blob.removed.includes(justResolved.path))
  assert.equal(await exists(resolvedLongAgo.id), false)
})

test('행을 먼저 지우고 그때 지워진 행의 첨부만 Blob에서 지운다 — 상태가 바뀐 행의 파일은 남는다', async () => {
  const { deleteOutboundEmailsReturningPaths } = await import(
    `../../src/db/queries/mailbox.ts?t=${Date.now()}-${Math.random()}`
  )
  const stillFailed = await plant({ status: 'failed', ageDays: 60 })
  const flipped = await plant({ status: 'failed', ageDays: 60 })
  // 후보로 뽑힌 뒤 운영자가 sent로 확정했다고 가정한다.
  await setup.execute({
    sql: "UPDATE outbound_emails SET status='sent' WHERE id = ?",
    args: [flipped.id],
  })

  const result = await deleteOutboundEmailsReturningPaths(
    [stillFailed.id, flipped.id],
    ['failed', 'blocked']
  )

  assert.equal(result.deletedCount, 1)
  assert.deepEqual(result.blobPaths, [stillFailed.path])
  assert.ok(
    !result.blobPaths.includes(flipped.path),
    '바뀐 행의 첨부 경로가 지울 목록에 들어가면 안 된다'
  )
  assert.equal(await exists(flipped.id), true)
  assert.equal(await attachmentRows(flipped.id), 1)
  assert.equal(await exists(stillFailed.id), false)
})

test('정리는 운영 배포에서만 허용된다 — 로컬·E2E·프리뷰는 DB와 Blob이 같은 환경이라는 보장이 없다', async () => {
  const { sweepAllowedHere } = await mod()
  assert.equal(sweepAllowedHere({ VERCEL_ENV: 'production' }), true)
  for (const env of [
    {},
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'development' },
    { NODE_ENV: 'production' },
  ]) {
    assert.equal(sweepAllowedHere(env), false, JSON.stringify(env))
  }
})

// ── 고아 Blob ────────────────────────────────────────────────────────────────

test('참조되지 않는 오래된 Blob만 지우고 참조되는 것·젊은 것·접두어 밖은 건드리지 않는다', async () => {
  const { sweepOutbound } = await mod()
  const kept = await plant({ status: 'sent', ageDays: 1 })
  const now = Date.now()
  const oldOrphan = `mailbox-sent/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`
  const youngOrphan = `mailbox-sent/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`
  const listed = [
    { pathname: kept.path, uploadedAt: new Date(now - 10 * DAY) }, // 참조됨
    { pathname: oldOrphan, uploadedAt: new Date(now - 2 * DAY) }, // 고아, 충분히 오래됨
    { pathname: youngOrphan, uploadedAt: new Date(now - 60 * 60 * 1000) }, // 고아지만 업로드 중일 수 있음
    // 접두어 밖 — 목록에 섞여 와도 절대 지우면 안 된다(DB 덤프가 `backups/`에 산다).
    { pathname: 'backups/dump.sql', uploadedAt: new Date(now - 90 * DAY) },
    {
      pathname: `mailbox/${crypto.randomUUID()}/${crypto.randomUUID()}`,
      uploadedAt: new Date(now - 90 * DAY),
    },
    { pathname: 'mailbox-sent/../backups/x', uploadedAt: new Date(now - 90 * DAY) },
  ]
  const blob = fakeBlob({ listed })

  const result = await sweepOutbound(now, CONFIG, blob)

  assert.deepEqual(
    blob.removed.filter(p => !p.startsWith('mailbox-sent/') || p === oldOrphan),
    [oldOrphan]
  )
  assert.ok(!blob.removed.includes(kept.path))
  assert.ok(!blob.removed.includes(youngOrphan))
  assert.ok(!blob.removed.some(p => p.startsWith('backups/') || p.startsWith('mailbox/')))
  assert.equal(result.orphanBlobsDeleted, 1)
})

test('한 번에 지우는 고아는 100개로 제한한다 — 크론 시간 제한', async () => {
  const { sweepOutbound } = await mod()
  const now = Date.now()
  // 고아 150개만 있으면 차단기가 걸린다 — 정상 비율(참조 다수)이 되도록 참조 파일을 섞는다.
  const referenced = []
  for (let i = 0; i < 400; i++) referenced.push(await plant({ status: 'sent', ageDays: 3 }))
  const orphans = Array.from({ length: 150 }, () => ({
    pathname: `mailbox-sent/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`,
    uploadedAt: new Date(now - 3 * DAY),
  }))
  const listed = [
    ...referenced.map(r => ({ pathname: r.path, uploadedAt: new Date(now - 3 * DAY) })),
    ...orphans,
  ]
  const blob = fakeBlob({ listed })
  const result = await sweepOutbound(now, CONFIG, blob)
  assert.equal(result.orphanSweepAborted, null)
  assert.equal(result.orphanBlobsDeleted, 100)
})

test('차단기: 오래된 후보 대부분이 참조 없음으로 보이면 아무것도 지우지 않고 멈춘다', async () => {
  // DB와 Blob 저장소가 서로 다른 환경을 가리키는 상황(예: 테스트 서버가 운영 토큰을 쥔 경우)을 흉내 낸다 —
  // 운영 Blob의 파일 8개가 로컬 DB에는 하나도 없다.
  const { sweepOutbound } = await mod()
  const now = Date.now()
  const listed = Array.from({ length: 8 }, () => ({
    pathname: `mailbox-sent/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`,
    uploadedAt: new Date(now - 5 * DAY),
  }))
  const blob = fakeBlob({ listed })

  const result = await sweepOutbound(now, CONFIG, blob)

  assert.equal(result.orphanSweepAborted, 'high_orphan_ratio')
  assert.equal(result.orphanBlobsDeleted, 0)
  assert.deepEqual(blob.removed, [], '차단기가 걸렸는데 파일이 지워졌다')
})

test('차단기: 후보가 적거나 고아 비율이 낮으면 정상적으로 지운다', async () => {
  const { sweepOutbound } = await mod()
  const now = Date.now()
  // 후보 4개(기준 5개 미만)가 전부 고아 — 소규모에서는 차단하지 않는다.
  const few = Array.from({ length: 4 }, () => ({
    pathname: `mailbox-sent/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`,
    uploadedAt: new Date(now - 5 * DAY),
  }))
  const r1 = await sweepOutbound(now, CONFIG, fakeBlob({ listed: few }))
  assert.equal(r1.orphanSweepAborted, null)
  assert.equal(r1.orphanBlobsDeleted, 4)

  // 후보 10개 중 참조 8개, 고아 2개(20%) — 차단하지 않는다.
  const referenced = []
  for (let i = 0; i < 8; i++) referenced.push(await plant({ status: 'sent', ageDays: 3 }))
  const orphans = Array.from({ length: 2 }, () => ({
    pathname: `mailbox-sent/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`,
    uploadedAt: new Date(now - 5 * DAY),
  }))
  const listed = [
    ...referenced.map(r => ({ pathname: r.path, uploadedAt: new Date(now - 5 * DAY) })),
    ...orphans,
  ]
  const blob = fakeBlob({ listed })
  const r2 = await sweepOutbound(now, CONFIG, blob)
  assert.equal(r2.orphanSweepAborted, null)
  assert.equal(r2.orphanBlobsDeleted, 2)
  assert.ok(
    referenced.every(r => !blob.removed.includes(r.path)),
    '참조되는 첨부가 지워졌다'
  )
})
