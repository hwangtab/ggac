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
async function plant({ status, ageDays, attachment = true }) {
  const id = crypto.randomUUID()
  const created = Date.now() - ageDays * DAY
  await setup.execute({
    sql: `INSERT INTO outbound_emails
      (id, idempotency_key, to_addresses, recipient_count, subject, body_html, status, created_at, updated_at)
      VALUES (?, ?, '["a@example.com"]', 1, 's', '<p>x</p>', ?, ?, ?)`,
    args: [id, `k-${id}`, status, created, created],
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

test('정리 시점에 상태가 바뀐 행은 지우지 않는다', async () => {
  const { deleteOutboundEmails } = await import(
    `../../src/db/queries/mailbox.ts?t=${Date.now()}-${Math.random()}`
  )
  const row = await plant({ status: 'failed', ageDays: 60 })
  // 후보로 뽑힌 뒤 운영자가 sent로 확정했다고 가정한다.
  await setup.execute({
    sql: "UPDATE outbound_emails SET status='sent' WHERE id = ?",
    args: [row.id],
  })
  assert.equal(await deleteOutboundEmails([row.id], ['failed', 'blocked']), 0)
  assert.equal(await exists(row.id), true)
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
  const listed = Array.from({ length: 150 }, () => ({
    pathname: `mailbox-sent/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`,
    uploadedAt: new Date(now - 3 * DAY),
  }))
  const blob = fakeBlob({ listed })
  const result = await sweepOutbound(now, CONFIG, blob)
  assert.equal(result.orphanBlobsDeleted, 100)
})
