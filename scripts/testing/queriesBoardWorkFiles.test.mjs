import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 업무툴 파일 쿼리 계층(`src/db/queries/work/files.ts`)과 첨부 읽기 판정(`src/work/lib/files/queries.ts`
 * getReadableAttachment)을 실제 SQLite 파일 DB로 검증한다.
 *
 * 원본 kosmart-work는 Postgres 트리거(harden_attachments_write·attachments_count)와 RLS(attachments_select =
 * can_read_channel)가 지켰다. 여기서는 쓰기 함수가 같은 트랜잭션에서, 읽기는 명시적 읽기 범위가 지킨다 — 이 파일이
 * 그 약속의 안전망이다. 저장소(Blob)는 부르지 않는다(승격의 저장소 검사는 boardWorkFiles.test.mjs의 checkPromotable).
 */

const DB_PATH = 'scripts/testing/.queries-board-work-files-test.db'
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
    readable: await import(src('work/lib/files/queries.ts')),
    paths: await import(src('work/lib/files/paths.ts')),
  }
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

let counter = 0
async function seedPerson(flags = { is_director: true }) {
  const id = crypto.randomUUID()
  await Q.profiles.upsertProfile({
    id,
    email: `bwf-${++counter}@test.local`,
    display_name: `이사${counter}`,
    registration_status: 'approved',
    is_active: true,
    ...flags,
  })
  return id
}

async function seedChannel({ kind = 'public', creatorId }) {
  const id = crypto.randomUUID()
  const label = `파일-${id.slice(0, 8)}`
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

async function seedMessage(channelId, authorId, body = '첨부 메시지') {
  const id = crypto.randomUUID()
  const r = await Q.messages.insertMessage({
    id,
    channelId,
    authorId,
    body,
    canPostRestricted: true,
  })
  assert.equal(r.status, 'created')
  return id
}

async function seedPending(channelId, uploaderId, name = '회의자료.pdf', size = 1234) {
  const id = crypto.randomUUID()
  const ok = await Q.files.insertPendingUploads(
    [
      {
        id,
        channelId,
        uploaderId,
        blobPath: Q.paths.buildUploadPath(id, name),
        name,
        mime: 'application/pdf',
        size,
      },
    ],
    { maxPerUser: 100 }
  )
  assert.equal(ok, true)
  return id
}

async function row(sql, args) {
  const rs = await setupClient.execute({ sql, args })
  return rs.rows[0]
}

const viewer = (userId, role = 'member') => ({
  user: { id: userId },
  staff: { user_id: userId, display_name: 'x', title: null, role, status: 'active' },
})

test('승격: 임시 행을 지우고 첨부를 만들며, 메시지 첨부 수·채널 rev·메시지 rev 를 한 트랜잭션에서 올린다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const msg = await seedMessage(ch, me)
  const before = await row('select rev from work_channels where id = ?', [ch])
  const up1 = await seedPending(ch, me, '첫째.pdf', 100)
  const up2 = await seedPending(ch, me, '둘째.pdf', 200)

  const a1 = await Q.files.promotePendingUpload({
    uploadId: up1,
    messageId: msg,
    actorId: me,
    size: 100,
  })
  const a2 = await Q.files.promotePendingUpload({
    uploadId: up2,
    messageId: msg,
    actorId: me,
    size: 200,
  })
  assert.equal(a1.message_id, msg)
  assert.equal(a1.channel_id, ch)
  assert.equal(a1.uploader_id, me)
  assert.equal(a1.name, '첫째.pdf')
  assert.equal(a1.size, 100)
  assert.equal(
    a1.bucket_path,
    Q.paths.buildUploadPath(up1, '첫째.pdf'),
    '키는 임시 업로드 그대로(옮기지 않는다)'
  )
  assert.equal(a1.version_no, 1)
  assert.equal(a1.is_latest, true)
  assert.equal(a1.version_root_id, null)
  assert.notEqual(a1.id, up1, '첨부 id 는 새로 만든다')

  const m = await row('select attachments_count, rev from work_messages where id = ?', [msg])
  const c = await row('select rev from work_channels where id = ?', [ch])
  assert.equal(Number(m.attachments_count), 2)
  assert.equal(Number(c.rev), Number(before.rev) + 2)
  assert.equal(
    Number(m.rev),
    Number(c.rev),
    '메시지 rev 는 마지막 변경 때의 채널 rev — 폴링이 다시 읽는다'
  )
  const left = await row('select count(*) as n from work_pending_uploads where id in (?, ?)', [
    up1,
    up2,
  ])
  assert.equal(Number(left.n), 0)

  // 폴링 커서: 승격 전 rev 이후로 바뀐 메시지에 이 메시지가 나온다
  const changed = await Q.messages.listChangedMessageIds(ch, Number(before.rev), Number(c.rev), 100)
  assert.ok(changed.includes(msg))

  // 같은 업로드를 두 번 승격할 수 없다(두 메시지에 붙지 않는다)
  const msg2 = await seedMessage(ch, me)
  await assert.rejects(
    Q.files.promotePendingUpload({ uploadId: up1, messageId: msg2, actorId: me, size: 100 }),
    e => Q.shared.isWorkWriteError(e, 'not_found')
  )
  assert.ok(a2)
})

test('승격 거부: 다른 채널의 업로드·남의 업로드·남의 메시지·지워진 메시지·보관 채널', async () => {
  const me = await seedPerson()
  const other = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const ch2 = await seedChannel({ creatorId: me })
  const msg = await seedMessage(ch, me)

  // 다른 채널에서 준비한 업로드
  const wrong = await seedPending(ch2, me)
  await assert.rejects(
    Q.files.promotePendingUpload({ uploadId: wrong, messageId: msg, actorId: me, size: 1234 }),
    e => Q.shared.isWorkWriteError(e, 'invalid_target')
  )
  // 실패하면 임시 행은 그대로 남는다(트랜잭션 롤백)
  assert.equal(
    Number((await row('select count(*) as n from work_pending_uploads where id = ?', [wrong])).n),
    1
  )

  // 남의 임시 업로드는 "없음"
  await Q.channels.addChannelMemberRows(ch, [other])
  const theirs = await seedPending(ch, other)
  await assert.rejects(
    Q.files.promotePendingUpload({ uploadId: theirs, messageId: msg, actorId: me, size: 1234 }),
    e => Q.shared.isWorkWriteError(e, 'not_found')
  )
  // 남의 메시지에 내 업로드를 붙일 수 없다
  const mine = await seedPending(ch, me)
  const theirMsg = await seedMessage(ch, other)
  await assert.rejects(
    Q.files.promotePendingUpload({ uploadId: mine, messageId: theirMsg, actorId: me, size: 1234 }),
    e => Q.shared.isWorkWriteError(e, 'forbidden')
  )
  // 지워진 메시지
  const gone = await seedMessage(ch, me)
  await Q.messages.softDeleteMessage({ messageId: gone, actorId: me, actorIsAdmin: false })
  await assert.rejects(
    Q.files.promotePendingUpload({ uploadId: mine, messageId: gone, actorId: me, size: 1234 }),
    e => Q.shared.isWorkWriteError(e, 'deleted')
  )
  // 보관된 채널
  const archivedCh = await seedChannel({ creatorId: me })
  const archivedMsg = await seedMessage(archivedCh, me)
  const archivedUp = await seedPending(archivedCh, me)
  await Q.channels.archiveChannelRow(archivedCh)
  await assert.rejects(
    Q.files.promotePendingUpload({
      uploadId: archivedUp,
      messageId: archivedMsg,
      actorId: me,
      size: 1234,
    }),
    e => Q.shared.isWorkWriteError(e, 'archived')
  )
  // 문서 초안 행(draft_meta)은 일반 첨부로 승격하지 않는다(3단계 저장 액션 전용)
  const draft = await seedPending(ch, me)
  await setupClient.execute({
    sql: `update work_pending_uploads set draft_meta = '{"kind":"doc-edit"}' where id = ?`,
    args: [draft],
  })
  await assert.rejects(
    Q.files.promotePendingUpload({ uploadId: draft, messageId: msg, actorId: me, size: 1234 }),
    e => Q.shared.isWorkWriteError(e, 'not_found')
  )
  assert.equal(
    Number(
      (await row('select attachments_count from work_messages where id = ?', [msg]))
        .attachments_count
    ),
    0
  )
})

test('임시 업로드 상한: 같은 트랜잭션에서 다시 세어 넘으면 한 행도 넣지 않는다', async () => {
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  const rows = n =>
    Array.from({ length: n }, () => {
      const id = crypto.randomUUID()
      return {
        id,
        channelId: ch,
        uploaderId: me,
        blobPath: Q.paths.buildUploadPath(id, 'a.pdf'),
        name: 'a.pdf',
        mime: 'application/pdf',
        size: 1,
      }
    })
  assert.equal(await Q.files.insertPendingUploads(rows(3), { maxPerUser: 4 }), true)
  assert.equal(await Q.files.countPendingUploads(me), 3)
  assert.equal(await Q.files.insertPendingUploads(rows(2), { maxPerUser: 4 }), false)
  assert.equal(await Q.files.countPendingUploads(me), 3, '넘친 묶음은 통째로 들어가지 않는다')
  assert.equal(await Q.files.insertPendingUploads(rows(1), { maxPerUser: 4 }), true)
  // 업로더가 여럿 섞인 묶음은 거부(상한을 사람별로 셀 수 없다)
  const other = await seedPerson()
  const mixed = rows(2)
  mixed[1].uploaderId = other
  await assert.rejects(Q.files.insertPendingUploads(mixed, { maxPerUser: 100 }), e =>
    Q.shared.isWorkWriteError(e, 'forbidden')
  )
  // 남의 임시 업로드는 조회·삭제되지 않는다
  const id = (
    await Q.files.getPendingUploads(
      [rows(0)].flat().map(r => r.id),
      me
    )
  ).length
  assert.equal(id, 0)
  const mineIds = (
    await setupClient.execute({
      sql: 'select id from work_pending_uploads where uploader_id = ?',
      args: [me],
    })
  ).rows.map(r => r.id)
  assert.equal(await Q.files.deletePendingUploads(mineIds, other), 0)
  assert.equal((await Q.files.getPendingUploads(mineIds, other)).length, 0)
  assert.equal(await Q.files.deletePendingUploads(mineIds, me), mineIds.length)
})

test('첨부 읽기(getReadableAttachment): 읽을 수 없는 채널·지워진 메시지·남의 DM 은 null, 짝으로 허용 쪽도 본다', async () => {
  const owner = await seedPerson({ is_auditor: true })
  const director = await seedPerson()
  const admin = await seedPerson({ is_admin: true })

  // 비공개 채널(감사 owner, 이사는 멤버 아님)
  const priv = await seedChannel({ kind: 'private', creatorId: owner })
  const privMsg = await seedMessage(priv, owner)
  const privUp = await seedPending(priv, owner)
  const privFile = await Q.files.promotePendingUpload({
    uploadId: privUp,
    messageId: privMsg,
    actorId: owner,
    size: 1234,
  })

  assert.equal(await Q.readable.getReadableAttachment(viewer(director), privFile.id), null)
  assert.equal(
    (await Q.readable.getReadableAttachment(viewer(owner), privFile.id))?.id,
    privFile.id
  )
  // 관리자는 비공개 채널을 읽는다(원본 0037)
  assert.equal(
    (await Q.readable.getReadableAttachment(viewer(admin, 'admin'), privFile.id))?.id,
    privFile.id
  )

  // DM(이사–감사): 관리자도 못 읽는다
  const dm = await Q.channels.openDmRow({
    key: [owner, director]
      .map(v => v.toLowerCase())
      .sort()
      .join(':'),
    creatorId: director,
    memberIds: [owner, director],
  })
  const dmMsg = await seedMessage(dm.id, director)
  const dmUp = await seedPending(dm.id, director)
  const dmFile = await Q.files.promotePendingUpload({
    uploadId: dmUp,
    messageId: dmMsg,
    actorId: director,
    size: 1234,
  })
  assert.equal(await Q.readable.getReadableAttachment(viewer(admin, 'admin'), dmFile.id), null)
  assert.equal((await Q.readable.getReadableAttachment(viewer(owner), dmFile.id))?.id, dmFile.id)

  // 메시지가 지워지면 첨부도 읽지 못한다
  await Q.messages.softDeleteMessage({ messageId: privMsg, actorId: owner, actorIsAdmin: false })
  assert.equal(await Q.readable.getReadableAttachment(viewer(owner), privFile.id), null)

  // 없는 id
  assert.equal(await Q.readable.getReadableAttachment(viewer(owner), crypto.randomUUID()), null)

  // 행의 경로가 업무툴 파일 키가 아니면(다른 영역을 가리키면) 읽기 대상이 아니다
  const pub = await seedChannel({ creatorId: owner })
  const pubMsg = await seedMessage(pub, owner)
  const pubFile = await Q.files.promotePendingUpload({
    uploadId: await seedPending(pub, owner),
    messageId: pubMsg,
    actorId: owner,
    size: 1234,
  })
  assert.equal(
    (await Q.readable.getReadableAttachment(viewer(director), pubFile.id))?.id,
    pubFile.id
  )
  await setupClient.execute({
    sql: `update work_attachments set blob_path = 'backups/ggac-prod.sql.gz' where id = ?`,
    args: [pubFile.id],
  })
  assert.equal(await Q.readable.getReadableAttachment(viewer(director), pubFile.id), null)
})

test('목록·메시지 첨부: 읽기 범위 밖·지워진 메시지는 결과에 없고, 폴더 집계도 같다', async () => {
  const me = await seedPerson()
  const outsider = await seedPerson()
  const pub = await seedChannel({ creatorId: me })
  const priv = await seedChannel({ kind: 'private', creatorId: me })
  const pubMsg = await seedMessage(pub, me)
  const privMsg = await seedMessage(priv, me)
  const delMsg = await seedMessage(pub, me)
  const pubFile = await Q.files.promotePendingUpload({
    uploadId: await seedPending(pub, me, '공개.pdf'),
    messageId: pubMsg,
    actorId: me,
    size: 1234,
  })
  const privFile = await Q.files.promotePendingUpload({
    uploadId: await seedPending(priv, me, '비공개.pdf'),
    messageId: privMsg,
    actorId: me,
    size: 1234,
  })
  const delFile = await Q.files.promotePendingUpload({
    uploadId: await seedPending(pub, me, '지움.pdf'),
    messageId: delMsg,
    actorId: me,
    size: 1234,
  })
  await Q.messages.softDeleteMessage({ messageId: delMsg, actorId: me, actorIsAdmin: false })
  await setupClient.execute({
    sql: `update work_attachments set folder_path = '회의/2026' where id = ?`,
    args: [pubFile.id],
  })

  const onlyPub = new Set([pub])
  const listed = await Q.files.listFileRecords({ readable: onlyPub, offset: 0, limit: 100 })
  const ids = listed.map(r => r.id)
  assert.ok(ids.includes(pubFile.id))
  assert.ok(!ids.includes(privFile.id), '읽을 수 없는 채널의 첨부가 목록에 나오면 안 된다')
  assert.ok(!ids.includes(delFile.id), '지워진 메시지의 첨부는 목록에 없다')
  assert.equal(listed.find(r => r.id === pubFile.id).channels.id, pub)

  // 읽기 범위가 비면 아무것도 없다(빈 IN 대신 거짓 조건)
  assert.deepEqual(
    await Q.files.listFileRecords({ readable: new Set(), offset: 0, limit: 100 }),
    []
  )
  // 채널 필터를 읽을 수 없는 채널로 줘도 새지 않는다
  assert.deepEqual(
    await Q.files.listFileRecords({ readable: onlyPub, channelId: priv, offset: 0, limit: 100 }),
    []
  )
  // 이름 검색의 LIKE 메타문자는 문자 그대로
  assert.deepEqual(
    (await Q.files.listFileRecords({ readable: onlyPub, q: '%', offset: 0, limit: 100 })).map(
      r => r.id
    ),
    []
  )
  assert.deepEqual(
    (await Q.files.listFileRecords({ readable: onlyPub, q: '공개', offset: 0, limit: 100 })).map(
      r => r.id
    ),
    [pubFile.id]
  )

  const byMsg = await Q.files.listAttachmentsForMessages([pubMsg, privMsg], onlyPub)
  assert.deepEqual(
    byMsg.map(a => a.id),
    [pubFile.id]
  )

  assert.deepEqual(await Q.files.listSubfolderCounts(pub, '', onlyPub), [
    { name: '회의', file_count: 1 },
  ])
  assert.deepEqual(await Q.files.listSubfolderCounts(pub, '회의', onlyPub), [
    { name: '2026', file_count: 1 },
  ])
  assert.deepEqual(await Q.files.listSubfolderCounts(pub, '', new Set([priv])), [])

  // 바깥 사람 기준 필터 선택지에는 읽을 수 없는 채널이 없다
  const channels = await Q.files.listFilterChannels(new Set([pub]))
  assert.deepEqual(
    channels.map(c => c.id),
    [pub]
  )
  assert.ok(outsider)
})
