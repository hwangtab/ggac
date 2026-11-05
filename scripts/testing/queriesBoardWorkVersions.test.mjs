import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 업무툴 문서 버전 쿼리 계층(`src/db/queries/work/versions.ts`, 3단계)을 실제 SQLite 파일 DB로 검증한다.
 *
 * 원본 kosmart-work는 Postgres 트리거(harden_attachments_write의 계보 계산·P0409, recompute_attachment_latest,
 * 메시지 삭제 뒤 재계산)와 유일 인덱스가 지켰다. 여기서는 쓰기 함수가 같은 트랜잭션에서 지킨다 — 이 파일이 그 약속의
 * 안전망이다. 저장소(Blob)는 부르지 않는다.
 */

const DB_PATH = 'scripts/testing/.queries-board-work-versions-test.db'
const src = rel => new URL(`../../src/${rel}`, import.meta.url).href

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let setupClient
let Q

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  Q = {
    profiles: await import(src('db/queries/profiles.ts')),
    shared: await import(src('db/queries/work/_shared.ts')),
    channels: await import(src('db/queries/work/channels.ts')),
    messages: await import(src('db/queries/work/messages.ts')),
    files: await import(src('db/queries/work/files.ts')),
    versions: await import(src('db/queries/work/versions.ts')),
    paths: await import(src('work/lib/files/paths.ts')),
  }
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

let counter = 0
async function seedPerson() {
  const id = crypto.randomUUID()
  await Q.profiles.upsertProfile({
    id,
    email: `bwv-${++counter}@test.local`,
    display_name: `이사${counter}`,
    registration_status: 'approved',
    is_active: true,
    is_director: true,
  })
  return id
}

async function seedChannel(creatorId, kind = 'public') {
  const id = crypto.randomUUID()
  const label = `버전-${id.slice(0, 8)}`
  const outcome = await Q.channels.createChannelRow({
    id,
    kind,
    name: label,
    slug: label.toLowerCase(),
    topic: null,
    categoryId: null,
    creatorId,
  })
  assert.equal(outcome.status, 'created')
  return id
}

async function seedPending(channelId, uploaderId, name = '보고서.hwp', size = 100) {
  const id = crypto.randomUUID()
  const ok = await Q.files.insertPendingUploads(
    [
      {
        id,
        channelId,
        uploaderId,
        blobPath: Q.paths.buildUploadPath(id, name),
        name,
        mime: 'application/x-hwp',
        size,
      },
    ],
    { maxPerUser: 100 }
  )
  assert.equal(ok, true)
  return id
}

/** 게시물 + v1(계보 없음) */
async function seedV1(channelId, actorId, name = '보고서.hwp') {
  const up = await seedPending(channelId, actorId, name)
  const r = await Q.versions.commitFileMessage({
    actorId,
    message: {
      id: crypto.randomUUID(),
      channelId,
      parentId: null,
      canPostRestricted: true,
      body: () => '파일',
    },
    source: { kind: 'pending', uploadId: up, allowDraft: false, size: 100 },
  })
  assert.equal(r.status, 'created')
  return r.attachment
}

/** 새 버전(앞 버전 = previous) */
async function saveVersion(channelId, actorId, previousAttachmentId, opts = {}) {
  const up = opts.uploadId ?? (await seedPending(channelId, actorId, opts.name ?? '보고서.hwp'))
  return Q.versions.commitFileMessage({
    actorId,
    message: {
      id: crypto.randomUUID(),
      channelId,
      parentId: opts.parentId ?? null,
      canPostRestricted: true,
      body: no => `v${no} 저장`,
    },
    source: { kind: 'pending', uploadId: up, allowDraft: opts.allowDraft ?? false, size: 100 },
    previousAttachmentId,
    folderPath: opts.folderPath ?? null,
    clearOwnCheckout: opts.clearOwnCheckout ?? false,
  })
}

async function row(sql, args) {
  const rs = await setupClient.execute({ sql, args })
  return rs.rows[0]
}

const isErr = code => e => Q.shared.isWorkWriteError(e, code)

test('새 버전을 게시하면 옛 버전 게시물의 rev 도 오른다 — 열린 화면이 "이전 버전" 표시를 받는다(2026-11-05 점검)', async () => {
  const me = await seedPerson()
  const ch = await seedChannel(me)
  const v1 = await seedV1(ch, me)
  const before = Number(
    (await row('select rev from work_messages where id = ?', [v1.message_id])).rev
  )
  const v2 = (await saveVersion(ch, me, v1.id)).attachment
  const after = Number(
    (await row('select rev from work_messages where id = ?', [v1.message_id])).rev
  )
  assert.ok(after > before, `v1 게시물의 rev 가 올라야 한다(${before} → ${after})`)
  const chRev = Number((await row('select rev from work_channels where id = ?', [ch])).rev)
  assert.ok(after <= chRev)
  // 폴링이 그 메시지를 바뀐 것으로 돌려준다
  const changed = await Q.messages.listChangedMessageIds(ch, before, chRev, 200)
  assert.ok(changed.includes(v1.message_id))
  assert.ok(changed.includes(v2.message_id))
})

test('버전 번호·계보: root 는 v1 id, 번호는 계보 최대+1, 앞 버전 id 를 남기고 최신만 is_latest', async () => {
  const me = await seedPerson()
  const ch = await seedChannel(me)
  const v1 = await seedV1(ch, me)
  assert.equal(v1.version_no, 1)
  assert.equal(v1.version_root_id, null)
  assert.equal(v1.is_latest, true)

  const r2 = await saveVersion(ch, me, v1.id, { folderPath: '회의/10월' })
  assert.equal(r2.status, 'created')
  const v2 = r2.attachment
  assert.equal(v2.version_no, 2)
  assert.equal(v2.version_root_id, v1.id)
  assert.equal(v2.previous_attachment_id, v1.id)
  assert.equal(v2.folder_path, '회의/10월')
  // 본문은 실제 번호로 만든다
  assert.equal(
    (await row('select body from work_messages where id = ?', [v2.message_id])).body,
    'v2 저장'
  )

  const v3 = (await saveVersion(ch, me, v2.id)).attachment
  assert.equal(v3.version_no, 3)
  assert.equal(v3.version_root_id, v1.id, 'root 는 늘 v1 — 앞 버전의 root 를 잇는다')

  const flags = await setupClient.execute({
    sql: 'select version_no, is_latest from work_attachments where coalesce(version_root_id, id) = ? order by version_no',
    args: [v1.id],
  })
  assert.deepEqual(
    flags.rows.map(r => [Number(r.version_no), Number(r.is_latest)]),
    [
      [1, 0],
      [2, 0],
      [3, 1],
    ]
  )

  // 계보 목록(읽기 범위 안) — 번호 큰 순, 아무 버전을 앵커로 써도 같다
  const list = await Q.versions.listLineageVersions(v2.id, new Set([ch]))
  assert.deepEqual(
    list.map(r => r.version_no),
    [3, 2, 1]
  )
  assert.equal(list[0].uploader_name, '이사' + counter)
  // 읽기 범위 밖이면 빈 목록
  assert.deepEqual(await Q.versions.listLineageVersions(v2.id, new Set()), [])
})

test('is_latest 재계산: 최신 게시물을 지우면 앞 버전이 다시 최신, 다음 저장 번호는 빈 곳을 남긴다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel(me)
  const v1 = await seedV1(ch, me)
  const v2 = (await saveVersion(ch, me, v1.id)).attachment
  const v3 = (await saveVersion(ch, me, v2.id)).attachment

  await Q.messages.softDeleteMessage({ messageId: v3.message_id, actorId: me, actorIsAdmin: false })
  const latest = await setupClient.execute({
    sql: 'select id from work_attachments where coalesce(version_root_id, id) = ? and is_latest = 1',
    args: [v1.id],
  })
  assert.deepEqual(
    latest.rows.map(r => r.id),
    [v2.id],
    '최신 게시물이 지워지면 그 앞 버전이 최신'
  )

  // 지워진 v3 위로는 저장할 수 없다(최신이 아니다) — v2 위로 저장하면 번호는 4(지워진 3을 다시 쓰지 않는다)
  await assert.rejects(saveVersion(ch, me, v3.id), isErr('conflict'))
  const v4 = (await saveVersion(ch, me, v2.id)).attachment
  assert.equal(v4.version_no, 4)

  // 계보 목록은 지워진 버전도 보여 준다(삭제 표시)
  const list = await Q.versions.listLineageVersions(v1.id, new Set([ch]))
  assert.deepEqual(
    list.map(r => [r.version_no, r.message_deleted]),
    [
      [4, false],
      [3, true],
      [2, false],
      [1, false],
    ]
  )

  // 모든 게시물이 지워지면 최신이 하나도 없다
  for (const a of [v1, v2, v4]) {
    await Q.messages.softDeleteMessage({
      messageId: a.message_id,
      actorId: me,
      actorIsAdmin: false,
    })
  }
  const none = await row(
    'select count(*) as n from work_attachments where coalesce(version_root_id, id) = ? and is_latest = 1',
    [v1.id]
  )
  assert.equal(Number(none.n), 0)
})

test('충돌: 앞 버전이 최신이 아니면 conflict 이고, 실패하면 게시물·첨부가 남지 않고 임시 업로드는 그대로다', async () => {
  const me = await seedPerson()
  const other = await seedPerson()
  const ch = await seedChannel(me)
  await Q.channels.addChannelMemberRows(ch, [other])
  const v1 = await seedV1(ch, me)
  await saveVersion(ch, other, v1.id) // 남이 먼저 v2

  const before = await row('select count(*) as n from work_messages where channel_id = ?', [ch])
  const up = await seedPending(ch, me)
  await assert.rejects(saveVersion(ch, me, v1.id, { uploadId: up }), isErr('conflict'))
  const after = await row('select count(*) as n from work_messages where channel_id = ?', [ch])
  assert.equal(Number(after.n), Number(before.n), '게시물이 남지 않는다(한 트랜잭션)')
  assert.equal(
    Number((await row('select count(*) as n from work_pending_uploads where id = ?', [up])).n),
    1,
    '임시 업로드는 그대로 — "그래도 저장"이 같은 업로드로 이어진다'
  )
})

test('동시 저장 경합: 같은 앞 버전으로 두 번 저장하면 뒤엣것은 conflict, 같은 계보·같은 번호는 유일 인덱스가 막고 conflict 로 바뀐다', async () => {
  // 실제 동시 실행은 로컬 파일 SQLite 에서 SQLITE_BUSY 로 끝나 재현할 수 없다(Turso 도 쓰기는 직렬이다).
  // 그래서 ① 경합의 결과 상태(앞 버전이 더는 최신이 아님)와 ② 유일 인덱스 자체와 ③ 유일성 위반 → conflict 매핑을 따로 본다.
  const me = await seedPerson()
  const other = await seedPerson()
  const ch = await seedChannel(me)
  await Q.channels.addChannelMemberRows(ch, [other])
  const v1 = await seedV1(ch, me)
  const ups = [await seedPending(ch, me), await seedPending(ch, other)]
  const first = await saveVersion(ch, me, v1.id, { uploadId: ups[0] })
  assert.equal(first.attachment.version_no, 2)
  await assert.rejects(saveVersion(ch, other, v1.id, { uploadId: ups[1] }), isErr('conflict'))
  const n = await row(
    'select count(*) as n from work_attachments where coalesce(version_root_id, id) = ? and version_no = 2',
    [v1.id]
  )
  assert.equal(Number(n.n), 1)

  // ② 유일 인덱스 자체: 같은 계보·같은 번호 행은 DB 가 거부한다(트랜잭션 밖 경로가 생겨도)
  await assert.rejects(
    setupClient.execute({
      sql: `insert into work_attachments (id, message_id, channel_id, uploader_id, blob_path, name, mime, size, version_root_id, version_no)
            select ?, message_id, channel_id, uploader_id, ?, name, mime, size, ?, 2 from work_attachments where id = ?`,
      args: [crypto.randomUUID(), `board-work/files/${crypto.randomUUID()}/x.hwp`, v1.id, v1.id],
    }),
    /UNIQUE/
  )

  // ③ 쓰기 중 유일성 위반은 conflict 로 바뀌고 게시물도 남지 않는다(같은 키의 객체를 두 첨부가 가리키려 할 때로 재현)
  const msgsBefore = await row('select count(*) as n from work_messages where channel_id = ?', [ch])
  await assert.rejects(
    Q.versions.commitFileMessage({
      actorId: me,
      message: {
        id: crypto.randomUUID(),
        channelId: ch,
        parentId: null,
        canPostRestricted: true,
        body: () => 'x',
      },
      source: {
        kind: 'copy',
        blobPath: first.attachment.bucket_path,
        name: 'x.hwp',
        mime: 'application/x-hwp',
        size: 1,
        width: null,
        height: null,
      },
      previousAttachmentId: first.attachment.id,
    }),
    isErr('conflict')
  )
  const msgsAfter = await row('select count(*) as n from work_messages where channel_id = ?', [ch])
  assert.equal(Number(msgsAfter.n), Number(msgsBefore.n))
})

test('데이터 규칙: 다른 채널의 앞 버전·남의 임시 업로드·초안 행·비멤버·보관 채널·경로 위장은 거부', async () => {
  const me = await seedPerson()
  const stranger = await seedPerson()
  const ch = await seedChannel(me)
  const ch2 = await seedChannel(me)
  const v1 = await seedV1(ch, me)

  // 다른 채널의 업로드로 이 계보에 잇기
  const up2 = await seedPending(ch2, me)
  await assert.rejects(
    Q.versions.commitFileMessage({
      actorId: me,
      message: {
        id: crypto.randomUUID(),
        channelId: ch2,
        parentId: null,
        canPostRestricted: true,
        body: () => 'x',
      },
      source: { kind: 'pending', uploadId: up2, allowDraft: false, size: 1 },
      previousAttachmentId: v1.id,
    }),
    isErr('invalid_target')
  )
  // 비멤버는 게시할 수 없다(트랜잭션 안에서 다시 본다)
  const theirUp = await seedPending(ch, stranger)
  await assert.rejects(saveVersion(ch, stranger, v1.id, { uploadId: theirUp }), isErr('forbidden'))
  // 남의 임시 업로드는 없음
  await assert.rejects(saveVersion(ch, me, v1.id, { uploadId: theirUp }), isErr('not_found'))
  // 초안 행은 allowDraft 일 때만
  const draft = await seedPending(ch, me)
  await Q.versions.setPendingDraftMeta(draft, me, { kind: 'doc-edit', blocked: false })
  await assert.rejects(saveVersion(ch, me, v1.id, { uploadId: draft }), isErr('not_found'))
  const viaDraft = await saveVersion(ch, me, v1.id, { uploadId: draft, allowDraft: true })
  assert.equal(viaDraft.attachment.version_no, 2)
  // 경로 위장(복사 원천이 업무툴 파일 키가 아님)
  await assert.rejects(
    Q.versions.commitFileMessage({
      actorId: me,
      message: {
        id: crypto.randomUUID(),
        channelId: ch,
        parentId: null,
        canPostRestricted: true,
        body: () => 'x',
      },
      source: {
        kind: 'copy',
        blobPath: 'backups/ggac-prod.sql.gz',
        name: 'x.hwp',
        mime: 'application/x-hwp',
        size: 1,
        width: null,
        height: null,
      },
      previousAttachmentId: viaDraft.attachment.id,
    }),
    isErr('invalid')
  )
  // 보관 채널
  await Q.channels.archiveChannelRow(ch)
  await assert.rejects(saveVersion(ch, me, viaDraft.attachment.id), isErr('archived'))
})

test('되돌리기(복사 원천): 옛 버전 객체를 새 키로 복사한 첨부가 새 최신 버전이 된다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel(me)
  const v1 = await seedV1(ch, me, '안건.docx')
  const v2 = (await saveVersion(ch, me, v1.id, { name: '안건.docx' })).attachment
  const copyKey = Q.paths.buildUploadPath(crypto.randomUUID(), '안건.docx')
  const r = await Q.versions.commitFileMessage({
    actorId: me,
    message: {
      id: crypto.randomUUID(),
      channelId: ch,
      parentId: null,
      canPostRestricted: true,
      body: no => `v1 내용으로 되돌림(v${no})`,
    },
    source: {
      kind: 'copy',
      blobPath: copyKey,
      name: v1.name,
      mime: v1.mime,
      size: v1.size,
      width: null,
      height: null,
    },
    previousAttachmentId: v2.id,
    folderPath: v2.folder_path,
  })
  assert.equal(r.status, 'created')
  assert.equal(r.attachment.version_no, 3)
  assert.equal(r.attachment.bucket_path, copyKey)
  assert.equal(r.attachment.is_latest, true)
  const list = await Q.versions.listLineageVersions(v1.id, new Set([ch]))
  assert.deepEqual(
    list.map(x => [x.version_no, x.is_latest]),
    [
      [3, true],
      [2, false],
      [1, false],
    ]
  )
})

test('같은 게시물 id 재시도는 멱등(내 것) · 남의 id 는 conflict', async () => {
  const me = await seedPerson()
  const other = await seedPerson()
  const ch = await seedChannel(me)
  await Q.channels.addChannelMemberRows(ch, [other])
  const messageId = crypto.randomUUID()
  const up = await seedPending(ch, me, '새 문서.docx')
  const input = {
    actorId: me,
    message: {
      id: messageId,
      channelId: ch,
      parentId: null,
      canPostRestricted: true,
      body: () => '새 문서',
    },
    source: { kind: 'pending', uploadId: up, allowDraft: false, size: 10 },
    folderPath: '서식',
  }
  const first = await Q.versions.commitFileMessage(input)
  assert.equal(first.status, 'created')
  const again = await Q.versions.commitFileMessage(input)
  assert.equal(again.status, 'duplicate')
  assert.equal(again.attachment.id, first.attachment.id)
  const up2 = await seedPending(ch, other)
  await assert.rejects(
    Q.versions.commitFileMessage({
      ...input,
      actorId: other,
      source: { kind: 'pending', uploadId: up2, allowDraft: false, size: 10 },
    }),
    isErr('conflict')
  )
})

test('수정 중: 한 사람만 · 만료되면 남이 잡는다 · force 는 덮어쓴다 · 해제는 보유자 id 가 맞을 때만', async () => {
  const me = await seedPerson()
  const other = await seedPerson()
  const ch = await seedChannel(me)
  const v1 = await seedV1(ch, me)
  const t0 = new Date('2026-11-02T01:00:00Z')
  const hours = h => new Date(t0.getTime() + h * 3600_000)

  const a = await Q.versions.acquireCheckout({
    rootId: v1.id,
    channelId: ch,
    userId: me,
    now: t0,
    until: hours(8),
    force: false,
  })
  assert.equal(a.status, 'acquired')
  assert.equal(a.previousHolder, null)
  // 내가 다시 잡으면 연장(acquired)
  assert.equal(
    (
      await Q.versions.acquireCheckout({
        rootId: v1.id,
        channelId: ch,
        userId: me,
        now: hours(1),
        until: hours(9),
        force: false,
      })
    ).status,
    'acquired'
  )
  // 남은 held
  const held = await Q.versions.acquireCheckout({
    rootId: v1.id,
    channelId: ch,
    userId: other,
    now: hours(2),
    until: hours(10),
    force: false,
  })
  assert.equal(held.status, 'held')
  assert.equal(held.holderId, me)
  assert.equal(
    held.holderName,
    (await row('select display_name from member_profiles where id = ?', [me])).display_name
  )
  // 남이 해제할 수 없다(보유자 id 가 다르면 0행)
  assert.equal(await Q.versions.clearCheckout(v1.id, other), false)
  // force 는 덮어쓴다 — 앞 보유자를 알려 준다(감사 기록용)
  const forced = await Q.versions.acquireCheckout({
    rootId: v1.id,
    channelId: ch,
    userId: other,
    now: hours(2),
    until: hours(10),
    force: true,
  })
  assert.equal(forced.status, 'acquired')
  assert.equal(forced.previousHolder, me)
  // 만료 뒤에는 force 없이도 잡힌다
  const expired = await Q.versions.acquireCheckout({
    rootId: v1.id,
    channelId: ch,
    userId: me,
    now: hours(11),
    until: hours(19),
    force: false,
  })
  assert.equal(expired.status, 'acquired')
  assert.equal(expired.previousHolder, null, '만료된 표시는 보유로 치지 않는다')

  // 내 수정 중 목록: 유효한 것만, 계보 최신 버전 id 로
  const v2 = (await saveVersion(ch, me, v1.id)).attachment
  const mine = await Q.versions.listMyCheckoutRecords(me, hours(12), new Set([ch]))
  assert.deepEqual(
    mine.map(m => [m.rootId, m.attachmentId]),
    [[v1.id, v2.id]]
  )
  assert.deepEqual(await Q.versions.listMyCheckoutRecords(me, hours(20), new Set([ch])), [])
  assert.deepEqual(await Q.versions.listMyCheckoutRecords(me, hours(12), new Set()), [])

  // 저장하면서 내 수정 중을 같은 트랜잭션에서 푼다
  await saveVersion(ch, me, v2.id, { clearOwnCheckout: true })
  assert.equal((await Q.versions.getFileLineage(v1.id)).checkout_user_id, null)

  // 계보의 첫 버전이 아닌 id 로는 잡을 수 없다
  await assert.rejects(
    Q.versions.acquireCheckout({
      rootId: v2.id,
      channelId: ch,
      userId: me,
      now: t0,
      until: hours(8),
      force: false,
    }),
    isErr('invalid_target')
  )
  // 보유자 본인은 해제할 수 있다
  await Q.versions.acquireCheckout({
    rootId: v1.id,
    channelId: ch,
    userId: me,
    now: new Date(),
    until: new Date(Date.now() + 3600_000),
    force: false,
  })
  assert.equal(await Q.versions.clearCheckout(v1.id, me), true)
})

test('최종본: 그 계보의 버전만 지정할 수 있고, 해제하면 비운다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel(me)
  const v1 = await seedV1(ch, me)
  const v2 = (await saveVersion(ch, me, v1.id)).attachment
  const otherLineage = await seedV1(ch, me, '다른.hwp')

  await Q.versions.setFinalVersion({
    rootId: v1.id,
    channelId: ch,
    attachmentId: v1.id,
    markedBy: me,
  })
  assert.equal((await Q.versions.getFileLineage(v1.id)).final_attachment_id, v1.id)
  await Q.versions.setFinalVersion({
    rootId: v1.id,
    channelId: ch,
    attachmentId: v2.id,
    markedBy: me,
  })
  const l = await Q.versions.getFileLineage(v1.id)
  assert.equal(l.final_attachment_id, v2.id)
  assert.equal(l.final_marked_by, me)
  await assert.rejects(
    Q.versions.setFinalVersion({
      rootId: v1.id,
      channelId: ch,
      attachmentId: otherLineage.id,
      markedBy: me,
    }),
    isErr('invalid_target')
  )
  await Q.versions.clearFinalVersion(v1.id)
  assert.equal((await Q.versions.getFileLineage(v1.id)).final_attachment_id, null)
})

test('버전 게시물 부모: v1 게시물(답글이면 그 부모) · 지워졌으면 살아 있는 최근 버전의 스레드 맨 위', async () => {
  const me = await seedPerson()
  const ch = await seedChannel(me)
  const v1 = await seedV1(ch, me)
  const v1Msg = v1.message_id
  assert.equal(await Q.versions.resolveVersionParentId(v1.id), v1Msg)
  const v2 = (await saveVersion(ch, me, v1.id, { parentId: v1Msg })).attachment
  // 답글 게시물의 첨부를 앵커로 써도 스레드 맨 위
  assert.equal(await Q.versions.resolveVersionParentId(v2.id), v1Msg)
  await Q.messages.softDeleteMessage({ messageId: v1Msg, actorId: me, actorIsAdmin: false })
  assert.equal(await Q.versions.resolveVersionParentId(v1.id), null)
  // v2 는 지워진 v1 게시물의 답글이라 그 맨 위도 지워졌다 → 대체 부모 없음
  assert.equal(await Q.versions.resolveLatestLiveVersionParentId([v1.id, v2.id]), null)
  const v3 = (await saveVersion(ch, me, v2.id)).attachment
  assert.equal(
    await Q.versions.resolveLatestLiveVersionParentId([v1.id, v2.id, v3.id]),
    v3.message_id
  )
})

test('편집 판정 재료: 첨부·게시물 삭제·채널(종류·보관·게시 정책)을 한 번에', async () => {
  const me = await seedPerson()
  const ch = await seedChannel(me, 'private')
  const v1 = await seedV1(ch, me)
  const rec = await Q.versions.getAttachmentForEdit(v1.id)
  assert.equal(rec.channel.kind, 'private')
  assert.equal(rec.channel.archived_at, null)
  assert.equal(rec.message_deleted_at, null)
  assert.equal(await Q.versions.getAttachmentForEdit(crypto.randomUUID()), null)
})
