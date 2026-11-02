import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 이사회 업무툴 2단계 쿼리 계층(`src/db/queries/work/{tabs,notes,tasks}.ts`)을 실제 SQLite 파일 DB로 검증한다.
 *
 * 원본 kosmart-work는 이 규칙들을 Postgres 트리거·RLS가 지켰다(harden_conversation_tabs_write·
 * harden_conversation_notes_write·record_conversation_note_revision·delete_note_with_tab·harden_tasks_write·
 * tasks_* 정책). ggac에는 그 장치가 없으므로 쓰기 함수가 같은 트랜잭션에서 지킨다 — 이 파일이 그 약속의 안전망이다.
 * 짝(허용·거부)을 함께 단언한다.
 */

const DB_PATH = 'scripts/testing/.queries-board-work-tabs-test.db'
const url = rel => new URL(`../../src/db/queries/${rel}`, import.meta.url).href

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let setupClient
let Q

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  Q = {
    profiles: await import(url('profiles.ts')),
    shared: await import(url('work/_shared.ts')),
    channels: await import(url('work/channels.ts')),
    messages: await import(url('work/messages.ts')),
    tabs: await import(url('work/tabs.ts')),
    notes: await import(url('work/notes.ts')),
    tasks: await import(url('work/tasks.ts')),
    client: await import(new URL('../../src/db/client.ts', import.meta.url).href),
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
    email: `bwt-${++counter}@test.local`,
    display_name: `이사${counter}`,
    registration_status: 'approved',
    is_active: true,
    ...flags,
  })
  return id
}

async function seedChannel({ kind = 'public', creatorId, members = [] } = {}) {
  const id = crypto.randomUUID()
  const label = `탭채널-${id.slice(0, 8)}`
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
  if (members.length) await Q.channels.addChannelMemberRows(id, members)
  return id
}

async function revs(channelId) {
  const rs = await setupClient.execute({
    sql: 'select rev, tabs_rev from work_channels where id = ?',
    args: [channelId],
  })
  return { rev: Number(rs.rows[0].rev), tabsRev: Number(rs.rows[0].tabs_rev) }
}

async function one(sql, args = []) {
  const rs = await setupClient.execute({ sql, args })
  return rs.rows[0]
}

async function expectWriteError(promise, code) {
  await assert.rejects(promise, e => {
    assert.ok(Q.shared.isWorkWriteError(e), `WorkWriteError여야 한다: ${e}`)
    assert.equal(e.code, code)
    return true
  })
}

function addTab(channelId, createdBy, extra = {}) {
  return Q.tabs.insertTabRow({
    channelId,
    kind: 'website',
    title: '사이트',
    config: { url: 'https://example.com/', embed: true },
    createdBy,
    canWriteArchived: false,
    ...extra,
  })
}

// ── 탭: harden_conversation_tabs_write ──────────────────────────────────────

test('탭 추가: 제목 trim, position은 max+1, 작성자 고정, tabs_rev와 rev가 같은 값으로 오른다', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const before = await revs(ch)
  const a = await addTab(ch, owner, { title: '  첫 탭  ' })
  const b = await addTab(ch, owner)
  assert.equal(a.title, '첫 탭')
  assert.equal(a.position, 0)
  assert.equal(b.position, 1)
  assert.equal(a.created_by, owner)
  // 중간 position이 비어도(0,5) 다음은 max+1
  await setupClient.execute({
    sql: 'update work_conversation_tabs set position = 5 where id = ?',
    args: [b.id],
  })
  const c = await addTab(ch, owner)
  assert.equal(c.position, 6)
  const after = await revs(ch)
  assert.equal(after.rev, before.rev + 3)
  assert.equal(after.tabsRev, after.rev)
})

test('탭 제목은 trim 후 1~40자 — 공백뿐이거나 41자면 invalid', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  await expectWriteError(addTab(ch, owner, { title: '   ' }), 'invalid')
  await expectWriteError(addTab(ch, owner, { title: 'ㄱ'.repeat(41) }), 'invalid')
  assert.equal((await addTab(ch, owner, { title: 'ㄱ'.repeat(40) })).title.length, 40)
})

test('탭 추가는 대화 멤버만 — 짝: 멤버가 되면 된다', async () => {
  const owner = await seedPerson()
  const outsider = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  await expectWriteError(addTab(ch, outsider), 'forbidden')
  await Q.channels.addChannelMemberRows(ch, [outsider])
  assert.equal((await addTab(ch, outsider)).created_by, outsider)
})

test('대화당 탭 20개 — 21번째는 limit, 다른 대화는 영향 없음', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const other = await seedChannel({ creatorId: owner })
  for (let i = 0; i < 20; i++) await addTab(ch, owner, { title: `탭${i}` })
  await expectWriteError(addTab(ch, owner), 'limit')
  assert.equal(await Q.tabs.countTabRows(ch), 20)
  await addTab(other, owner)
})

test('웹사이트 탭은 https만 — http·javascript·호스트 끝점(.)은 invalid', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  for (const bad of [
    'http://example.com/',
    'javascript:alert(1)',
    'https://',
    'https://kosmart.org./x',
    'https://example.com. ',
  ]) {
    await expectWriteError(addTab(ch, owner, { config: { url: bad } }), 'invalid')
  }
  const ok = await addTab(ch, owner, { config: { url: 'https://ggac.kr/about', extra: 'x' } })
  assert.deepEqual(ok.config, { url: 'https://ggac.kr/about', embed: true })
})

test('파일 탭: 첨부 표(2a) 전에는 어떤 attachmentId도 이 대화의 것이 아니다(invalid_target)', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  await expectWriteError(
    addTab(ch, owner, { kind: 'file', config: { attachmentId: crypto.randomUUID() } }),
    'invalid_target'
  )
  await expectWriteError(
    addTab(ch, owner, { kind: 'file', config: { attachmentId: 'not-a-uuid' } }),
    'invalid_target'
  )
  assert.equal(await Q.tabs.countTabRows(ch), 0)
})

test('위키·타임라인 탭은 만들 수 없다(가져오지 않은 종류)', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  await expectWriteError(addTab(ch, owner, { kind: 'wiki', config: { slug: 'a' } }), 'invalid')
  await expectWriteError(addTab(ch, owner, { kind: 'timeline', config: {} }), 'invalid')
})

test('할 일 탭은 대화당 1개 — 두 번째는 conflict, DB 부분 유일 인덱스도 막는다', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const other = await seedChannel({ creatorId: owner })
  await addTab(ch, owner, { kind: 'tasks', title: '할 일', config: {} })
  await expectWriteError(
    addTab(ch, owner, { kind: 'tasks', title: '할 일2', config: {} }),
    'conflict'
  )
  await addTab(other, owner, { kind: 'tasks', title: '할 일', config: {} })
  await assert.rejects(
    setupClient.execute({
      sql: `insert into work_conversation_tabs (id, channel_id, kind, title, position, config) values (?, ?, 'tasks', 'x', 9, '{}')`,
      args: [crypto.randomUUID(), ch],
    }),
    /UNIQUE/
  )
})

test('보관된 채널: 탭 추가·이름 바꾸기·삭제는 archived — 관리자(canWriteArchived)만 된다', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const tab = await addTab(ch, owner)
  await Q.channels.archiveChannelRow(ch)
  await expectWriteError(addTab(ch, owner), 'archived')
  await expectWriteError(
    Q.tabs.renameTabRow({ tabId: tab.id, title: '새 이름', canWriteArchived: false }),
    'archived'
  )
  await expectWriteError(
    Q.tabs.deleteTabRow({ tabId: tab.id, canWriteArchived: false }),
    'archived'
  )
  const renamed = await Q.tabs.renameTabRow({
    tabId: tab.id,
    title: '새 이름',
    canWriteArchived: true,
  })
  assert.equal(renamed.title, '새 이름')
  assert.ok(await addTab(ch, owner, { canWriteArchived: true }))
})

test('이름 바꾸기: trim·updated_at, 바꿀 수 없는 열(kind·channel·작성자·config)은 그대로. 같은 이름이면 rev도 그대로', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const tab = await addTab(ch, owner)
  const r0 = await revs(ch)
  const renamed = await Q.tabs.renameTabRow({
    tabId: tab.id,
    title: '  바뀐 이름 ',
    canWriteArchived: false,
  })
  assert.equal(renamed.title, '바뀐 이름')
  const row = await one('select * from work_conversation_tabs where id = ?', [tab.id])
  assert.equal(row.kind, 'website')
  assert.equal(row.channel_id, ch)
  assert.equal(row.created_by, owner)
  assert.equal(JSON.parse(row.config).url, 'https://example.com/')
  const r1 = await revs(ch)
  assert.equal(r1.tabsRev, r0.rev + 1)
  await Q.tabs.renameTabRow({ tabId: tab.id, title: '바뀐 이름', canWriteArchived: false })
  assert.deepEqual(await revs(ch), r1)
  assert.equal(
    await Q.tabs.renameTabRow({ tabId: crypto.randomUUID(), title: 'x', canWriteArchived: false }),
    null
  )
})

test('순서 바꾸기: 이 대화의 탭에만 적용된다(다른 대화 탭 id는 무시)', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const other = await seedChannel({ creatorId: owner })
  const a = await addTab(ch, owner)
  const b = await addTab(ch, owner)
  const x = await addTab(other, owner)
  const applied = await Q.tabs.reorderTabRows({
    channelId: ch,
    changes: [
      { id: a.id, position: 1 },
      { id: b.id, position: 0 },
      { id: x.id, position: 7 },
    ],
    canWriteArchived: false,
  })
  assert.equal(applied, 2)
  assert.deepEqual(
    (await Q.tabs.listTabRows(ch)).map(t => t.id),
    [b.id, a.id]
  )
  assert.equal((await Q.tabs.getTabRow(x.id)).position, 0)
})

// ── 메모 탭: 0024·0033 ──────────────────────────────────────────────────────

test('메모 탭: 메모(version 1)와 이력 1건을 같은 트랜잭션에서 만들고 config.noteId로 가리킨다', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const tab = await addTab(ch, owner, { kind: 'note', title: ' 회의 메모 ', config: {} })
  const noteId = tab.config.noteId
  const note = await Q.notes.getNoteRecord(noteId, ch)
  assert.equal(note.version, 1)
  assert.equal(note.title, '회의 메모')
  assert.equal(note.body, '')
  const revisions = await Q.notes.listNoteRevisionRows(noteId)
  assert.deepEqual(
    revisions.map(r => r.version),
    [1]
  )
  // 다른 대화 id로 물으면 없다
  assert.equal(await Q.notes.getNoteRecord(noteId, crypto.randomUUID()), null)
})

test('메모 탭 실패는 메모를 남기지 않는다(고아 메모 없음 — 0033 T2)', async () => {
  const owner = await seedPerson()
  const outsider = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  await expectWriteError(addTab(ch, outsider, { kind: 'note', config: {} }), 'forbidden')
  for (let i = 0; i < 20; i++) await addTab(ch, owner, { title: `탭${i}` })
  await expectWriteError(addTab(ch, owner, { kind: 'note', config: {} }), 'limit')
  const row = await one('select count(*) n from work_conversation_notes where channel_id = ?', [ch])
  assert.equal(Number(row.n), 0)
})

test('메모 탭의 noteId는 이 대화의 메모만, 같은 메모를 두 탭이 가리킬 수 없다', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const other = await seedChannel({ creatorId: owner })
  const tab = await addTab(ch, owner, { kind: 'note', config: {} })
  const noteId = tab.config.noteId
  await expectWriteError(
    addTab(other, owner, { kind: 'note', config: { noteId } }),
    'invalid_target'
  )
  await expectWriteError(
    addTab(ch, owner, { kind: 'note', config: { noteId: 'x' } }),
    'invalid_target'
  )
  await expectWriteError(addTab(ch, owner, { kind: 'note', config: { noteId } }), 'conflict')
})

test('메모는 대화당 30개(insertNoteInTx) — 31번째는 limit', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const { db } = Q.client
  for (let i = 0; i < 30; i++) {
    await db.transaction(tx =>
      Q.notes.insertNoteInTx(tx, { channelId: ch, title: `m${i}`, body: '', updatedBy: owner })
    )
  }
  await expectWriteError(
    db.transaction(tx =>
      Q.notes.insertNoteInTx(tx, { channelId: ch, title: 'x', body: '', updatedBy: owner })
    ),
    'limit'
  )
})

test('메모 탭을 지우면 메모와 이력도 지운다(delete_note_with_tab). 다른 탭 삭제는 메모를 건드리지 않는다', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const noteTab = await addTab(ch, owner, { kind: 'note', config: {} })
  const site = await addTab(ch, owner)
  const noteId = noteTab.config.noteId
  await Q.notes.saveNoteRow({
    noteId,
    expectedVersion: 1,
    body: '본문',
    actorId: owner,
    canWriteArchived: false,
  })
  await Q.tabs.deleteTabRow({ tabId: site.id, canWriteArchived: false })
  assert.ok(await Q.notes.getNoteRecord(noteId))
  const r0 = await revs(ch)
  const removed = await Q.tabs.deleteTabRow({ tabId: noteTab.id, canWriteArchived: false })
  assert.equal(removed.id, noteTab.id)
  assert.equal(await Q.notes.getNoteRecord(noteId), null)
  const left = await one('select count(*) n from work_note_revisions where note_id = ?', [noteId])
  assert.equal(Number(left.n), 0)
  assert.equal((await revs(ch)).tabsRev, r0.rev + 1)
  assert.equal(await Q.tabs.deleteTabRow({ tabId: noteTab.id, canWriteArchived: false }), null)
})

// ── 메모 저장: harden_conversation_notes_write · record_conversation_note_revision ──

async function newNote(ch, owner) {
  const tab = await addTab(ch, owner, { kind: 'note', config: {} })
  return tab.config.noteId
}

test('메모 저장: 본문이 바뀌면 version+1·updated_by=행위자·이력 추가·tabs_rev 오름. 같은 본문이면 셋 다 그대로', async () => {
  const owner = await seedPerson()
  const editor = await seedPerson()
  const ch = await seedChannel({ creatorId: owner, members: [editor] })
  const noteId = await newNote(ch, owner)
  const r0 = await revs(ch)
  const saved = await Q.notes.saveNoteRow({
    noteId,
    expectedVersion: 1,
    body: '# 안건',
    actorId: editor,
    canWriteArchived: false,
  })
  assert.equal(saved.status, 'saved')
  assert.equal(saved.note.version, 2)
  assert.equal(
    saved.note.updatedByName,
    (await one('select display_name from member_profiles where id = ?', [editor])).display_name
  )
  const r1 = await revs(ch)
  assert.equal(r1.tabsRev, r0.rev + 1)
  const row1 = await one(
    'select version, updated_at, updated_by from work_conversation_notes where id = ?',
    [noteId]
  )

  const same = await Q.notes.saveNoteRow({
    noteId,
    expectedVersion: 2,
    body: '# 안건',
    actorId: owner,
    canWriteArchived: false,
  })
  assert.equal(same.status, 'saved')
  assert.equal(same.note.version, 2)
  const row2 = await one(
    'select version, updated_at, updated_by from work_conversation_notes where id = ?',
    [noteId]
  )
  assert.deepEqual(row2, row1)
  assert.deepEqual(await revs(ch), r1)
  assert.deepEqual(
    (await Q.notes.listNoteRevisionRows(noteId)).map(r => r.version),
    [2, 1]
  )
  const rev2 = await Q.notes.getNoteRevisionRow(noteId, 2)
  assert.equal(rev2.body, '# 안건')
})

test('메모 저장: 제목만 바꿔도 새 버전, 제목은 trim·빈 값은 null', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const noteId = await newNote(ch, owner)
  const a = await Q.notes.saveNoteRow({
    noteId,
    expectedVersion: 1,
    body: '',
    title: '  새 제목 ',
    actorId: owner,
    canWriteArchived: false,
  })
  assert.equal(a.note.version, 2)
  assert.equal(a.note.title, '새 제목')
  const b = await Q.notes.saveNoteRow({
    noteId,
    expectedVersion: 2,
    body: '',
    title: '   ',
    actorId: owner,
    canWriteArchived: false,
  })
  assert.equal(b.note.version, 3)
  assert.equal(b.note.title, null)
})

test('메모 저장: 기대 버전이 다르면 conflict와 최신 메모(아무것도 바꾸지 않는다)', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const noteId = await newNote(ch, owner)
  await Q.notes.saveNoteRow({
    noteId,
    expectedVersion: 1,
    body: 'A',
    actorId: owner,
    canWriteArchived: false,
  })
  const stale = await Q.notes.saveNoteRow({
    noteId,
    expectedVersion: 1,
    body: 'B',
    actorId: owner,
    canWriteArchived: false,
  })
  assert.equal(stale.status, 'conflict')
  assert.equal(stale.latest.body, 'A')
  assert.equal(stale.latest.version, 2)
  assert.equal((await Q.notes.getNoteRecord(noteId)).body, 'A')
})

test('메모 저장: 대화 멤버만(비멤버 forbidden) · 보관 채널은 관리자만 · 없는 메모는 null', async () => {
  const owner = await seedPerson()
  const outsider = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const noteId = await newNote(ch, owner)
  await expectWriteError(
    Q.notes.saveNoteRow({
      noteId,
      expectedVersion: 1,
      body: 'x',
      actorId: outsider,
      canWriteArchived: true,
    }),
    'forbidden'
  )
  await Q.channels.archiveChannelRow(ch)
  await expectWriteError(
    Q.notes.saveNoteRow({
      noteId,
      expectedVersion: 1,
      body: 'x',
      actorId: owner,
      canWriteArchived: false,
    }),
    'archived'
  )
  const ok = await Q.notes.saveNoteRow({
    noteId,
    expectedVersion: 1,
    body: 'x',
    actorId: owner,
    canWriteArchived: true,
  })
  assert.equal(ok.note.version, 2)
  assert.equal(
    await Q.notes.saveNoteRow({
      noteId: crypto.randomUUID(),
      expectedVersion: 1,
      body: 'x',
      actorId: owner,
      canWriteArchived: true,
    }),
    null
  )
})

test('메모 이력은 메모당 최근 200개만 남는다', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const noteId = await newNote(ch, owner)
  for (let v = 1; v <= 205; v++) {
    const r = await Q.notes.saveNoteRow({
      noteId,
      expectedVersion: v,
      body: `본문 ${v}`,
      actorId: owner,
      canWriteArchived: false,
    })
    assert.equal(r.note.version, v + 1)
  }
  const agg = await one(
    'select count(*) n, min(version) lo, max(version) hi from work_note_revisions where note_id = ?',
    [noteId]
  )
  assert.equal(Number(agg.n), 200)
  assert.equal(Number(agg.hi), 206)
  assert.equal(Number(agg.lo), 7)
  assert.equal(await Q.notes.getNoteRevisionRow(noteId, 6), null)
  assert.equal((await Q.notes.listNoteRevisionRows(noteId)).length, 200)
})

// ── 할 일: 0006·0036 ────────────────────────────────────────────────────────

test('할 일 만들기: 작성자는 행위자, 채널 멤버만, 원본 메시지는 같은 채널만, tabs_rev 오름', async () => {
  const owner = await seedPerson()
  const outsider = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const other = await seedChannel({ creatorId: owner })
  const msgId = crypto.randomUUID()
  await Q.messages.insertMessage({
    id: msgId,
    channelId: other,
    authorId: owner,
    body: '다른 채널',
    canPostRestricted: false,
  })
  await expectWriteError(
    Q.tasks.insertTaskRow({
      channelId: ch,
      createdBy: outsider,
      actorIsAdmin: true,
      title: '남의 일',
    }),
    'forbidden'
  )
  await expectWriteError(
    Q.tasks.insertTaskRow({
      channelId: ch,
      createdBy: owner,
      actorIsAdmin: false,
      title: 'x',
      messageId: msgId,
    }),
    'invalid_target'
  )
  await expectWriteError(
    Q.tasks.insertTaskRow({ channelId: ch, createdBy: owner, actorIsAdmin: false, title: '   ' }),
    'invalid'
  )
  const r0 = await revs(ch)
  const t = await Q.tasks.insertTaskRow({
    channelId: ch,
    createdBy: owner,
    actorIsAdmin: false,
    title: ' 회의록 정리 ',
    dueOn: '2026-11-30',
  })
  assert.equal(t.created_by, owner)
  assert.equal(t.title, '회의록 정리')
  assert.equal(t.status, 'open')
  assert.equal(t.completed_at, null)
  assert.equal(t.channel.kind, 'public')
  assert.equal((await revs(ch)).tabsRev, r0.rev + 1)
})

test('할 일: done으로 만들면 완료 시각·완료자가 찍힌다(harden INSERT)', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const t = await Q.tasks.insertTaskRow({
    channelId: ch,
    createdBy: owner,
    actorIsAdmin: false,
    title: 'x',
    status: 'done',
  })
  assert.equal(t.status, 'done')
  assert.ok(t.completed_at)
  assert.equal(t.completed_by, owner)
})

test('할 일 수정 권한(OLD 행 기준): 생성자·담당자·채널 owner·관리자만 — 다른 멤버는 forbidden', async () => {
  const owner = await seedPerson()
  const creator = await seedPerson()
  const assignee = await seedPerson()
  const other = await seedPerson()
  const nonMemberAdmin = await seedPerson({ is_admin: true })
  const ch = await seedChannel({ creatorId: owner, members: [creator, assignee, other] })
  const t = await Q.tasks.insertTaskRow({
    channelId: ch,
    createdBy: creator,
    actorIsAdmin: false,
    title: '원래',
    assigneeId: assignee,
  })
  const upd = (actorId, actorIsAdmin, patch) =>
    Q.tasks.updateTaskRow({ id: t.id, actorId, actorIsAdmin, patch })
  assert.equal(await upd(other, false, { title: '남이 고침' }), 'forbidden')
  assert.equal(await upd(creator, false, { title: '생성자' }), 'updated')
  assert.equal(await upd(owner, false, { title: '채널 owner' }), 'updated')
  assert.equal(await upd(nonMemberAdmin, true, { title: '관리자' }), 'updated')
  // 0036 K1: 담당자는 담당을 남에게 넘길 수 있다 — 그 뒤엔 더 이상 담당자가 아니므로 못 고친다
  assert.equal(await upd(assignee, false, { assigneeId: other }), 'updated')
  assert.equal(await upd(assignee, false, { title: '이제 남' }), 'forbidden')
  assert.equal(await upd(other, false, { title: '새 담당자' }), 'updated')
  const row = await one(
    'select channel_id, created_by, title, assignee_id from work_tasks where id = ?',
    [t.id]
  )
  assert.equal(row.channel_id, ch)
  assert.equal(row.created_by, creator)
  assert.equal(row.title, '새 담당자')
  assert.equal(row.assignee_id, other)
  assert.equal(
    await Q.tasks.updateTaskRow({
      id: crypto.randomUUID(),
      actorId: owner,
      actorIsAdmin: true,
      patch: { title: 'x' },
    }),
    'not_found'
  )
})

test('할 일 완료 토글: open→done은 시각·행위자, done→done은 그대로, done→open은 비운다', async () => {
  const owner = await seedPerson()
  const member = await seedPerson()
  const ch = await seedChannel({ creatorId: owner, members: [member] })
  const t = await Q.tasks.insertTaskRow({
    channelId: ch,
    createdBy: member,
    actorIsAdmin: false,
    title: 'x',
  })
  await Q.tasks.updateTaskRow({
    id: t.id,
    actorId: owner,
    actorIsAdmin: false,
    patch: { status: 'done' },
  })
  const done1 = await one('select completed_at, completed_by from work_tasks where id = ?', [t.id])
  assert.equal(done1.completed_by, owner)
  assert.ok(done1.completed_at)
  await Q.tasks.updateTaskRow({
    id: t.id,
    actorId: member,
    actorIsAdmin: false,
    patch: { status: 'done', title: 'y' },
  })
  const done2 = await one('select completed_at, completed_by from work_tasks where id = ?', [t.id])
  assert.deepEqual(done2, done1)
  await Q.tasks.updateTaskRow({
    id: t.id,
    actorId: member,
    actorIsAdmin: false,
    patch: { status: 'open' },
  })
  const open = await one('select status, completed_at, completed_by from work_tasks where id = ?', [
    t.id,
  ])
  assert.equal(open.status, 'open')
  assert.equal(open.completed_at, null)
  assert.equal(open.completed_by, null)
})

test('할 일 삭제: 생성자·관리자만(담당자·채널 owner는 forbidden)', async () => {
  const owner = await seedPerson()
  const creator = await seedPerson()
  const assignee = await seedPerson()
  const ch = await seedChannel({ creatorId: owner, members: [creator, assignee] })
  const mk = () =>
    Q.tasks.insertTaskRow({
      channelId: ch,
      createdBy: creator,
      actorIsAdmin: false,
      title: 'x',
      assigneeId: assignee,
    })
  const a = await mk()
  assert.equal(
    await Q.tasks.deleteTaskRow({ id: a.id, actorId: assignee, actorIsAdmin: false }),
    'forbidden'
  )
  assert.equal(
    await Q.tasks.deleteTaskRow({ id: a.id, actorId: owner, actorIsAdmin: false }),
    'forbidden'
  )
  assert.equal(
    await Q.tasks.deleteTaskRow({ id: a.id, actorId: creator, actorIsAdmin: false }),
    'deleted'
  )
  const b = await mk()
  assert.equal(
    await Q.tasks.deleteTaskRow({ id: b.id, actorId: owner, actorIsAdmin: true }),
    'deleted'
  )
  assert.equal(
    await Q.tasks.deleteTaskRow({ id: b.id, actorId: owner, actorIsAdmin: true }),
    'not_found'
  )
})

test('보관 채널의 할 일: 만들기·고치기·지우기는 관리자만', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const t = await Q.tasks.insertTaskRow({
    channelId: ch,
    createdBy: owner,
    actorIsAdmin: false,
    title: 'x',
  })
  await Q.channels.archiveChannelRow(ch)
  await expectWriteError(
    Q.tasks.insertTaskRow({ channelId: ch, createdBy: owner, actorIsAdmin: false, title: 'y' }),
    'archived'
  )
  await expectWriteError(
    Q.tasks.updateTaskRow({
      id: t.id,
      actorId: owner,
      actorIsAdmin: false,
      patch: { status: 'done' },
    }),
    'archived'
  )
  await expectWriteError(
    Q.tasks.deleteTaskRow({ id: t.id, actorId: owner, actorIsAdmin: false }),
    'archived'
  )
  assert.equal(
    await Q.tasks.updateTaskRow({
      id: t.id,
      actorId: owner,
      actorIsAdmin: true,
      patch: { status: 'done' },
    }),
    'updated'
  )
})

test('할 일 목록: 읽기 범위 밖 채널은 내 것이어도 나오지 않는다. 배지는 내 미완료(담당=나 또는 내가 만든 무담당)·보관 제외', async () => {
  const me = await seedPerson()
  const other = await seedPerson()
  const readableCh = await seedChannel({ creatorId: other, members: [me] })
  const hiddenCh = await seedChannel({ kind: 'private', creatorId: other, members: [me] })
  const archivedCh = await seedChannel({ creatorId: other, members: [me] })
  const mineA = await Q.tasks.insertTaskRow({
    channelId: readableCh,
    createdBy: me,
    actorIsAdmin: false,
    title: '내가 만든 무담당',
  })
  await Q.tasks.insertTaskRow({
    channelId: readableCh,
    createdBy: me,
    actorIsAdmin: false,
    title: '남 담당',
    assigneeId: other,
  })
  await Q.tasks.insertTaskRow({
    channelId: readableCh,
    createdBy: other,
    actorIsAdmin: false,
    title: '내 담당',
    assigneeId: me,
  })
  await Q.tasks.insertTaskRow({
    channelId: hiddenCh,
    createdBy: me,
    actorIsAdmin: false,
    title: '숨은 채널',
  })
  await Q.tasks.insertTaskRow({
    channelId: archivedCh,
    createdBy: me,
    actorIsAdmin: false,
    title: '보관',
  })
  await Q.channels.archiveChannelRow(archivedCh)
  const readable = new Set([readableCh, archivedCh])
  const { rows, openTruncated } = await Q.tasks.listTaskRecordsForViewer({ userId: me, readable })
  assert.equal(openTruncated, false)
  assert.ok(rows.every(r => readable.has(r.channel_id)))
  assert.ok(!rows.some(r => r.title === '숨은 채널'))
  assert.ok(rows.some(r => r.id === mineA.id))
  assert.equal(rows.find(r => r.title === '보관').channel.archived_at !== null, true)
  assert.equal(await Q.tasks.countMyOpenTaskRecords({ userId: me, readable }), 2)
  assert.equal(await Q.tasks.countMyOpenTaskRecords({ userId: me, readable: new Set() }), 0)
})

test('채널을 지우면 탭·메모·이력·할 일이 함께 지워진다(FK cascade)', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const tab = await addTab(ch, owner, { kind: 'note', config: {} })
  await Q.tasks.insertTaskRow({ channelId: ch, createdBy: owner, actorIsAdmin: false, title: 'x' })
  await setupClient.execute('PRAGMA foreign_keys = ON')
  await setupClient.execute({ sql: 'delete from work_channels where id = ?', args: [ch] })
  for (const [table, col] of [
    ['work_conversation_tabs', 'channel_id'],
    ['work_conversation_notes', 'channel_id'],
    ['work_tasks', 'channel_id'],
  ]) {
    const r = await one(`select count(*) n from ${table} where ${col} = ?`, [ch])
    assert.equal(Number(r.n), 0, table)
  }
  const revRow = await one('select count(*) n from work_note_revisions where note_id = ?', [
    tab.config.noteId,
  ])
  assert.equal(Number(revRow.n), 0)
})
