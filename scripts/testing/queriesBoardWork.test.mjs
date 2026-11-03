import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 이사회 업무툴 쿼리 계층(`src/db/queries/work/*`)을 실제 SQLite 파일 DB로 검증한다.
 *
 * 원본 kosmart-work는 이 규칙들을 Postgres 트리거가 지켰다(harden_messages_write·sync_thread_counters·
 * blank_deleted_message·sync_message_links·sync_member_notify_level …). ggac에는 트리거가 없으므로
 * 쓰기 함수가 같은 트랜잭션에서 지킨다 — 이 파일이 그 약속의 안전망이다. 권한(누가 읽나)은 라우트·action 몫이라
 * 여기서는 "읽기 범위를 인자로 받으면 그 밖은 절대 돌려주지 않는다"만 본다.
 */

const DB_PATH = 'scripts/testing/.queries-board-work-test.db'
const url = rel => new URL(`../../src/db/queries/${rel}`, import.meta.url).href

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let setupClient
let Q // 모듈 묶음

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  Q = {
    profiles: await import(url('profiles.ts')),
    shared: await import(url('work/_shared.ts')),
    channels: await import(url('work/channels.ts')),
    messages: await import(url('work/messages.ts')),
    inbox: await import(url('work/inbox.ts')),
    links: await import(url('work/links.ts')),
    access: await import(url('work/access.ts')),
    sync: await import(url('work/sync.ts')),
    prefs: await import(url('work/prefs.ts')),
    directory: await import(url('work/directory.ts')),
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
    email: `bw-${++counter}@test.local`,
    display_name: `이사${counter}`,
    registration_status: 'approved',
    is_active: true,
    ...flags,
  })
  return id
}

async function seedChannel({ kind = 'public', creatorId, name } = {}) {
  const id = crypto.randomUUID()
  const label = name ?? `채널-${id.slice(0, 8)}`
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

async function channelRev(id) {
  const rs = await setupClient.execute({
    sql: 'select rev, pins_rev from work_channels where id = ?',
    args: [id],
  })
  return { rev: Number(rs.rows[0].rev), pinsRev: Number(rs.rows[0].pins_rev) }
}

async function messageRow(id) {
  const rs = await setupClient.execute({
    sql: 'select * from work_messages where id = ?',
    args: [id],
  })
  return rs.rows[0]
}

async function send(channelId, authorId, body, extra = {}) {
  const id = crypto.randomUUID()
  const r = await Q.messages.insertMessage({
    id,
    channelId,
    authorId,
    body,
    canPostRestricted: false,
    ...extra,
  })
  assert.equal(r.status, 'created')
  return id
}

// ── 채널 생성(add_channel_creator) ───────────────────────────────────────────

test('채널을 만들면 만든 사람이 owner 멤버가 되고 membership_rev가 오른다', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  const m = await Q.channels.getMembershipRecord(ch, owner)
  assert.equal(m.role, 'owner')
  assert.equal((await Q.sync.getMembershipRev(owner)) > 0, true)
})

test('보관 안 된 채널 이름은 공백·대소문자 무시하고 유일하다(보관하면 같은 이름을 다시 쓸 수 있다)', async () => {
  const owner = await seedPerson()
  const name = `Dup-${crypto.randomUUID().slice(0, 6)}`
  const first = await seedChannel({ creatorId: owner, name })
  const clash = await Q.channels.createChannelRow({
    id: crypto.randomUUID(),
    kind: 'public',
    name: `  ${name.toUpperCase()} `,
    slug: `${name.toLowerCase()}-2`,
    topic: null,
    categoryId: null,
    creatorId: owner,
  })
  assert.equal(clash.status, 'name_taken')
  await Q.channels.archiveChannelRow(first)
  const again = await Q.channels.createChannelRow({
    id: crypto.randomUUID(),
    kind: 'public',
    name,
    slug: `${name.toLowerCase()}-3`,
    topic: null,
    categoryId: null,
    creatorId: owner,
  })
  assert.equal(again.status, 'created')
  // 보관 해제는 이제 이름이 겹쳐 거부된다
  assert.equal((await Q.channels.unarchiveChannelRow(first)).status, 'name_taken')
})

// ── 메시지 쓰기(harden_messages_write · 폴링 rev) ────────────────────────────

test('새 메시지: 채널 rev가 1 오르고 메시지 rev가 그 값이다. kind는 text, 카운터는 0', async () => {
  const author = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const before = await channelRev(ch)
  const id = await send(ch, author, '안녕')
  const after = await channelRev(ch)
  assert.equal(after.rev, before.rev + 1)
  const row = await messageRow(id)
  assert.equal(Number(row.rev), after.rev)
  assert.equal(row.kind, 'text')
  assert.equal(Number(row.reply_count), 0)
  assert.equal(row.author_id, author)
  assert.equal(row.forwarded_from_id, null)
})

test('같은 id 재전송은 행을 바꾸지 않고 duplicate를 돌려준다(rev도 그대로)', async () => {
  const author = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const id = await send(ch, author, '처음')
  const rev = await channelRev(ch)
  const again = await Q.messages.insertMessage({
    id,
    channelId: ch,
    authorId: author,
    body: '바꿔치기',
    canPostRestricted: false,
  })
  assert.equal(again.status, 'duplicate')
  assert.equal(again.authorId, author)
  assert.equal((await messageRow(id)).body, '처음')
  assert.deepEqual(await channelRev(ch), rev)
})

test('보관된 채널에는 쓸 수 없다(archived) — 짝: 보관 전에는 된다', async () => {
  const author = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  await send(ch, author, '보관 전')
  await Q.channels.archiveChannelRow(ch)
  await assert.rejects(
    () =>
      Q.messages.insertMessage({
        id: crypto.randomUUID(),
        channelId: ch,
        authorId: author,
        body: '보관 후',
        canPostRestricted: true,
      }),
    e => e.code === 'archived'
  )
})

test('공지 채널(post_policy owners): 최상위 글은 canPostRestricted만, 답글은 누구나', async () => {
  const owner = await seedPerson()
  const member = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  // 멤버여야 한다 — 아니면 공지 규칙보다 먼저 멤버십(assertAuthorIsMember)에 걸려 이 테스트가 공지 규칙을 보지 못한다
  await Q.channels.addChannelMemberRows(ch, [member])
  await Q.channels.setChannelPostPolicyRow(ch, 'owners')
  await assert.rejects(
    () =>
      Q.messages.insertMessage({
        id: crypto.randomUUID(),
        channelId: ch,
        authorId: member,
        body: '공지?',
        canPostRestricted: false,
      }),
    e => e.code === 'owners_only'
  )
  const top = await send(ch, owner, '공지', { canPostRestricted: true })
  await send(ch, member, '답글', { parentId: top })
})

test('답글 부모는 존재·최상위·같은 채널이어야 한다', async () => {
  const author = await seedPerson()
  const a = await seedChannel({ creatorId: author })
  const b = await seedChannel({ creatorId: author })
  const top = await send(a, author, '부모')
  const reply = await send(a, author, '답글', { parentId: top })
  const reject = (channelId, parentId) =>
    assert.rejects(
      () =>
        Q.messages.insertMessage({
          id: crypto.randomUUID(),
          channelId,
          authorId: author,
          body: 'x',
          parentId,
          canPostRestricted: false,
        }),
      e => e.code === 'invalid_parent'
    )
  await reject(a, crypto.randomUUID()) // 없는 부모
  await reject(a, reply) // 답글에 답글(2단계)
  await reject(b, top) // 다른 채널의 부모
})

test('인용은 같은 채널 메시지만', async () => {
  const author = await seedPerson()
  const a = await seedChannel({ creatorId: author })
  const b = await seedChannel({ creatorId: author })
  const target = await send(a, author, '원문')
  await send(a, author, '인용 OK', { quotedMessageId: target })
  await assert.rejects(
    () =>
      Q.messages.insertMessage({
        id: crypto.randomUUID(),
        channelId: b,
        authorId: author,
        body: '다른 채널 인용',
        quotedMessageId: target,
        canPostRestricted: false,
      }),
    e => e.code === 'invalid_quote'
  )
})

// ── 답글 수(sync_thread_counters) ───────────────────────────────────────────

test('답글 수·마지막 답글 시각은 지워지지 않은 답글로 다시 센다. 부모 rev도 따라 오른다', async () => {
  const author = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const top = await send(ch, author, '부모')
  const r1 = await send(ch, author, '답1', { parentId: top })
  await new Promise(r => setTimeout(r, 5))
  const r2 = await send(ch, author, '답2', { parentId: top })
  let parent = await messageRow(top)
  assert.equal(Number(parent.reply_count), 2)
  assert.equal(Number(parent.last_reply_at), Number((await messageRow(r2)).created_at))
  assert.equal(Number(parent.rev), (await channelRev(ch)).rev, '부모 rev = 마지막 변경 rev')

  await Q.messages.softDeleteMessage({ messageId: r2, actorId: author, actorIsAdmin: false })
  parent = await messageRow(top)
  assert.equal(Number(parent.reply_count), 1)
  assert.equal(Number(parent.last_reply_at), Number((await messageRow(r1)).created_at))
  assert.equal(Number(parent.rev), (await channelRev(ch)).rev)
})

// ── 수정·삭제 ───────────────────────────────────────────────────────────────

test('수정: 작성자만·rev가 오르고 edited_at이 찍힌다. 같은 본문이면 아무것도 바꾸지 않는다', async () => {
  const author = await seedPerson()
  const other = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const id = await send(ch, author, '처음')
  await assert.rejects(
    () =>
      Q.messages.editMessageBody({
        messageId: id,
        actorId: other,
        body: '남이',
        actorIsAdmin: true,
      }),
    e => e.code === 'forbidden'
  )
  const r0 = await channelRev(ch)
  const same = await Q.messages.editMessageBody({
    messageId: id,
    actorId: author,
    body: '처음',
    actorIsAdmin: false,
  })
  assert.equal(same.status, 'unchanged')
  assert.deepEqual(await channelRev(ch), r0)
  await Q.messages.editMessageBody({
    messageId: id,
    actorId: author,
    body: '고침',
    actorIsAdmin: false,
  })
  const row = await messageRow(id)
  assert.equal(row.body, '고침')
  assert.ok(row.edited_at)
  assert.equal(Number(row.rev), r0.rev + 1)
})

test('삭제: 본문을 비우고(blank_deleted_message) rev가 오르며, 지운 뒤엔 고치지 못한다. 남의 글은 관리자만', async () => {
  const author = await seedPerson()
  const other = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const id = await send(ch, author, '비밀 https://example.com/x')
  await assert.rejects(
    () => Q.messages.softDeleteMessage({ messageId: id, actorId: other, actorIsAdmin: false }),
    e => e.code === 'forbidden'
  )
  const r0 = await channelRev(ch)
  await Q.messages.softDeleteMessage({ messageId: id, actorId: other, actorIsAdmin: true })
  const row = await messageRow(id)
  assert.equal(row.body, '')
  assert.ok(row.deleted_at)
  assert.equal(Number(row.rev), r0.rev + 1)
  const links = await setupClient.execute({
    sql: 'select * from work_message_links where message_id = ?',
    args: [id],
  })
  assert.equal(links.rows.length, 0, '지운 메시지의 링크 색인은 비운다')
  await assert.rejects(
    () =>
      Q.messages.editMessageBody({
        messageId: id,
        actorId: author,
        body: '되살림',
        actorIsAdmin: false,
      }),
    e => e.code === 'deleted'
  )
  const again = await Q.messages.softDeleteMessage({
    messageId: id,
    actorId: author,
    actorIsAdmin: false,
  })
  assert.equal(again.status, 'already')
})

test('고정된 메시지를 지우면 pins_rev도 오른다(고정 목록에서 빠지므로)', async () => {
  const author = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const id = await send(ch, author, '고정할 글')
  await Q.messages.togglePinRow({ channelId: ch, messageId: id, actorId: author })
  const pinned = await channelRev(ch)
  assert.equal(pinned.pinsRev, pinned.rev, '고정하면 pins_rev = 그때의 rev')
  await Q.messages.softDeleteMessage({ messageId: id, actorId: author, actorIsAdmin: false })
  const after = await channelRev(ch)
  assert.equal(after.pinsRev, after.rev)
  const readable = new Set([ch])
  assert.deepEqual(
    await Q.messages.fetchPinnedMessageIds(ch, readable),
    [],
    '지운 메시지의 고정은 빠진다'
  )
})

// ── 반응 ────────────────────────────────────────────────────────────────────

test('반응 추가·제거 모두 메시지 rev를 올린다. canAdd가 아니면 새로 달 수 없다(떼기는 된다)', async () => {
  const author = await seedPerson()
  const reactor = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const id = await send(ch, author, '반응해 줘')
  const r0 = await channelRev(ch)
  const on = await Q.messages.toggleReactionRow({
    messageId: id,
    userId: reactor,
    emoji: '👍',
    canAdd: true,
  })
  assert.equal(on.active, true)
  assert.equal(Number((await messageRow(id)).rev), r0.rev + 1)
  const off = await Q.messages.toggleReactionRow({
    messageId: id,
    userId: reactor,
    emoji: '👍',
    canAdd: false,
  })
  assert.equal(off.active, false)
  assert.equal(Number((await messageRow(id)).rev), r0.rev + 2)
  await assert.rejects(
    () =>
      Q.messages.toggleReactionRow({ messageId: id, userId: reactor, emoji: '🎉', canAdd: false }),
    e => e.code === 'forbidden'
  )
})

// ── 폴링: 바뀐 메시지 ────────────────────────────────────────────────────────

test('listChangedMessageIds: (since, upto] 사이에 바뀐 메시지만 — 새 글·수정·반응·답글로 바뀐 부모', async () => {
  const author = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const a = await send(ch, author, 'A')
  const b = await send(ch, author, 'B')
  const since = (await channelRev(ch)).rev
  await Q.messages.editMessageBody({
    messageId: a,
    actorId: author,
    body: 'A2',
    actorIsAdmin: false,
  })
  const reply = await send(ch, author, '답', { parentId: b })
  const upto = (await channelRev(ch)).rev
  const ids = await Q.messages.listChangedMessageIds(ch, since, upto, 200)
  assert.deepEqual(new Set(ids), new Set([a, b, reply]))
  assert.deepEqual(await Q.messages.listChangedMessageIds(ch, upto, upto, 200), [])
})

// ── 알림 수준 ↔ 뮤트(sync_member_notify_level) ───────────────────────────────

test('뮤트를 켜면 notify_level=off, 끄면 off였던 것만 기본(null). 알림 수준 off면 muted', async () => {
  const owner = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  await Q.channels.setMemberFlagRow(ch, owner, 'muted', true)
  let m = await Q.channels.getMembershipRecord(ch, owner)
  assert.equal(m.muted, true)
  assert.equal(m.notify_level, 'off')
  await Q.channels.setMemberFlagRow(ch, owner, 'muted', false)
  m = await Q.channels.getMembershipRecord(ch, owner)
  assert.equal(m.muted, false)
  assert.equal(m.notify_level, null)
  await Q.channels.setNotifyLevelRow(ch, owner, 'all')
  await Q.channels.setMemberFlagRow(ch, owner, 'muted', false)
  m = await Q.channels.getMembershipRecord(ch, owner)
  assert.equal(m.notify_level, 'all', 'off가 아니던 수준은 뮤트를 꺼도 그대로')
  await Q.channels.setNotifyLevelRow(ch, owner, 'off')
  m = await Q.channels.getMembershipRecord(ch, owner)
  assert.equal(m.muted, true)
})

// ── 링크 추출(0039) ─────────────────────────────────────────────────────────

test('링크 추출: 끝 구두점·짝 없는 괄호를 떼고, 한글 앞에서 자르고, 중복 없이 순서대로', () => {
  const { extractMessageUrls } = Q.links
  assert.deepEqual(
    extractMessageUrls(
      '보세요 https://a.example/x?y=1. 그리고 (https://b.example/p(1)) 또 https://a.example/x?y=1, 끝'
    ),
    ['https://a.example/x?y=1', 'https://b.example/p(1)']
  )
  assert.deepEqual(extractMessageUrls('https://c.example/경로'), ['https://c.example/'])
  assert.deepEqual(extractMessageUrls('http://ab'), [], '10자 미만은 버린다')
  assert.deepEqual(extractMessageUrls('http://a.b'), ['http://a.b'], '10자는 남긴다')
  assert.deepEqual(extractMessageUrls('<https://d.example/q>'), ['https://d.example/q'])
  const many = Array.from({ length: 25 }, (_, i) => `https://e.example/${i}`).join(' ')
  assert.equal(extractMessageUrls(many).length, 20)
})

test('메시지를 쓰고 고치면 링크 색인이 같이 바뀐다', async () => {
  const author = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const id = await send(ch, author, '링크 https://one.example/a 와 https://two.example/b')
  const urls = async () =>
    (
      await setupClient.execute({
        sql: 'select url from work_message_links where message_id = ? order by url',
        args: [id],
      })
    ).rows.map(r => r.url)
  assert.deepEqual(await urls(), ['https://one.example/a', 'https://two.example/b'])
  await Q.messages.editMessageBody({
    messageId: id,
    actorId: author,
    body: 'https://three.example/c',
    actorIsAdmin: false,
  })
  assert.deepEqual(await urls(), ['https://three.example/c'])
})

// ── 멘션(guard_mention_target) ──────────────────────────────────────────────

test('멘션 대상은 채널 멤버만, 작성자 제외. @channel은 멤버 전원', async () => {
  const author = await seedPerson()
  const member = await seedPerson()
  const outsider = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  await Q.channels.addChannelMemberRows(ch, [member])
  const id = await send(ch, author, '멘션')
  const ids = await Q.messages.recordMentionRows({
    messageId: id,
    authorId: author,
    explicitIds: [member, outsider, author],
    everyone: false,
  })
  assert.deepEqual(ids, [member])
  const id2 = await send(ch, member, '@channel')
  const all = await Q.messages.recordMentionRows({
    messageId: id2,
    authorId: member,
    explicitIds: [],
    everyone: true,
  })
  assert.deepEqual(all, [author])
})

// ── 안 읽은 수(my_channel_unread_counts) ────────────────────────────────────

test('안 읽은 수: last_read_at 이후·남의 글·최상위·지워지지 않은 것만. 멘션은 답글 포함. 읽음 처리하면 0', async () => {
  const me = await seedPerson()
  const other = await seedPerson()
  const ch = await seedChannel({ creatorId: other })
  await Q.channels.addChannelMemberRows(ch, [me])
  await Q.channels.markChannelReadRow(ch, me, new Date(Date.now() - 1000))
  const top = await send(ch, other, '1')
  await send(ch, other, '답', { parentId: top })
  const del = await send(ch, other, '지울 글')
  await Q.messages.softDeleteMessage({ messageId: del, actorId: other, actorIsAdmin: false })
  await send(ch, me, '내 글')
  const mention = await send(ch, other, '멘션 답', { parentId: top })
  await Q.messages.recordMentionRows({
    messageId: mention,
    authorId: other,
    explicitIds: [me],
    everyone: false,
  })

  let counts = await Q.channels.countUnreadByChannel(me)
  assert.deepEqual(counts.get(ch), { unread: 1, mentions: 1 })
  const cleared = await Q.channels.markChannelReadRow(ch, me, new Date(Date.now() + 1000))
  assert.equal(cleared, 1)
  counts = await Q.channels.countUnreadByChannel(me)
  assert.deepEqual(counts.get(ch), { unread: 0, mentions: 0 })
})

// ── 읽기 범위 ───────────────────────────────────────────────────────────────

test('읽기 범위 밖의 메시지는 id로 물어도 돌려주지 않고, 전달 원본 임베드도 null이다', async () => {
  const a = await seedPerson()
  const pub = await seedChannel({ creatorId: a })
  const priv = await seedChannel({ creatorId: a, kind: 'private' })
  const secret = await send(priv, a, '비공개 원문')
  const fwdId = crypto.randomUUID()
  const fw = await Q.messages.insertForwardedMessage({
    id: fwdId,
    channelId: pub,
    authorId: a,
    body: '전달',
    forwardedFromId: secret,
    sensitive: false,
    canPostRestricted: false,
  })
  assert.equal(fw.status, 'created')
  const onlyPublic = new Set([pub])
  assert.deepEqual(await Q.messages.fetchMessageRecords([secret], onlyPublic), [])
  const [record] = await Q.messages.fetchMessageRecords([fwdId], onlyPublic)
  assert.equal(record.forwarded_from_id, secret)
  assert.equal(record.forwarded, null, '원본을 읽을 수 없으면 임베드는 null("볼 수 없음")')
  const both = new Set([pub, priv])
  const [withEmbed] = await Q.messages.fetchMessageRecords([fwdId], both)
  assert.equal(withEmbed.forwarded.id, secret)
  assert.equal((await Q.messages.fetchMessagePageRecords(priv, onlyPublic)).messages.length, 0)
  assert.equal(await Q.inbox.countUnreadMentionRows(a, new Set()), 0)
})

// ── 직함(0033) ──────────────────────────────────────────────────────────────

test('업무툴 직함: work_member_prefs에만 쓰고 이사회 직함(director_title)은 그대로다', async () => {
  const p = await seedPerson({ is_director: true, director_title: '이사' })
  let row = (await Q.directory.getWorkPeople([p])).get(p)
  assert.equal(row.director_title, '이사')
  assert.equal(row.work_title, null, '행이 없으면 업무툴 직함도 없다(이사회 직함으로 떨어진다)')

  await Q.prefs.upsertMemberPrefs(p, { workTitle: '총무 담당' })
  row = (await Q.directory.getWorkPeople([p])).get(p)
  assert.equal(row.work_title, '총무 담당')
  assert.equal(row.director_title, '이사')
  assert.equal((await Q.prefs.getMemberPrefsRecord(p)).work_title, '총무 담당')
  assert.equal(
    (await Q.profiles.getProfileById(p)).director_title,
    '이사',
    '공식 직함은 바뀌지 않는다'
  )
  const listed = (await Q.directory.listWorkPeople()).find(r => r.user_id === p)
  assert.equal(listed.work_title, '총무 담당')

  // 다른 설정을 바꿔도 직함은 남고, null로 비우면 사라진다
  await Q.prefs.upsertMemberPrefs(p, { chatSort: 'name' })
  assert.equal((await Q.prefs.getMemberPrefsRecord(p)).work_title, '총무 담당')
  await Q.prefs.upsertMemberPrefs(p, { workTitle: null })
  assert.equal((await Q.directory.getWorkPeople([p])).get(p).work_title, null)
})

// ── 활동 ────────────────────────────────────────────────────────────────────

test('활동 확인 시각: 행이 없으면 처음 들어온 시각(prefs.created_at), 그것도 없으면 0', async () => {
  const fresh = await seedPerson()
  assert.equal(await Q.inbox.getActivitySeenAtMs(fresh), 0)
  await Q.channels.ensureWorkspaceEntryRows(fresh)
  const prefs = await Q.prefs.getMemberPrefsRecord(fresh)
  assert.equal(await Q.inbox.getActivitySeenAtMs(fresh), Date.parse(prefs.created_at))
  await Q.inbox.markActivitySeenRow(fresh)
  assert.ok((await Q.inbox.getActivitySeenAtMs(fresh)) >= Date.parse(prefs.created_at))
})

test('활동: 내 스레드의 남의 답글·내 글에 남이 단 반응. 알림 끔 채널과 읽기 범위 밖은 뺀다', async () => {
  const me = await seedPerson()
  const other = await seedPerson()
  const ch = await seedChannel({ creatorId: me })
  await Q.channels.addChannelMemberRows(ch, [other])
  const mine = await send(ch, me, '내 글')
  await send(ch, other, '남의 답', { parentId: mine })
  await Q.messages.toggleReactionRow({ messageId: mine, userId: other, emoji: '👍', canAdd: true })
  const readable = new Set([ch])
  let events = await Q.inbox.listActivityEventRows(me, 0, readable)
  assert.deepEqual(events.map(e => e.kind).sort(), ['reaction', 'reply'])
  assert.equal((await Q.inbox.listActivityEventRows(me, 0, new Set())).length, 0)
  await Q.channels.setNotifyLevelRow(ch, me, 'off')
  events = await Q.inbox.listActivityEventRows(me, 0, readable)
  assert.equal(events.length, 0)
})

// ── #전체 ───────────────────────────────────────────────────────────────────

test('ensureWorkspaceEntryRows: #전체를 한 번만 만들고 처음 들어온 사람을 멤버로 넣는다(멱등)', async () => {
  const p1 = await seedPerson()
  const p2 = await seedPerson()
  const a = await Q.channels.ensureWorkspaceEntryRows(p1)
  const b = await Q.channels.ensureWorkspaceEntryRows(p2)
  const c = await Q.channels.ensureWorkspaceEntryRows(p1)
  assert.ok(a.channelId)
  assert.equal(a.channelId, b.channelId)
  assert.equal(a.channelId, c.channelId)
  const rs = await setupClient.execute({
    sql: "select count(*) as n from work_channels where slug = '전체'",
  })
  assert.equal(Number(rs.rows[0].n), 1)
  assert.ok(await Q.channels.getMembershipRecord(a.channelId, p2))
})

test('ensureWorkspaceEntryRows: 스스로 나간 사람을 다음 진입 때 다시 넣지 않는다', async () => {
  const p = await seedPerson()
  const { channelId } = await Q.channels.ensureWorkspaceEntryRows(p)
  assert.ok(channelId)
  await setupClient.execute({
    sql: 'delete from work_channel_members where channel_id = ? and user_id = ?',
    args: [channelId, p],
  })
  await Q.channels.ensureWorkspaceEntryRows(p)
  assert.equal(await Q.channels.getMembershipRecord(channelId, p), null)
})

// 독립 권한 검토(2026-11-02): slug `전체`를 비공개·보관 채널이 갖고 있으면 그 채널에 모든 이사를 넣는 것이
// 곧 비공개 내용 공개다. 자동 가입은 보관되지 않은 공개 채널에만 한다.
for (const [label, patch, restore] of [
  ['비공개', "kind = 'private'", "kind = 'public'"],
  ['보관된', 'archived_at = 1', 'archived_at = null'],
]) {
  test(`ensureWorkspaceEntryRows: slug 전체가 ${label} 채널이면 처음 들어온 사람도 넣지 않는다`, async () => {
    await Q.channels.ensureWorkspaceEntryRows(await seedPerson()) // #전체가 없으면 만든다
    await setupClient.execute({ sql: `update work_channels set ${patch} where slug = '전체'` })
    try {
      const fresh = await seedPerson()
      const r = await Q.channels.ensureWorkspaceEntryRows(fresh)
      assert.equal(r.channelId, null)
      const rs = await setupClient.execute({
        sql: "select count(*) as n from work_channel_members m join work_channels c on c.id = m.channel_id where c.slug = '전체' and m.user_id = ?",
        args: [fresh],
      })
      assert.equal(Number(rs.rows[0].n), 0)
    } finally {
      await setupClient.execute({ sql: `update work_channels set ${restore} where slug = '전체'` })
    }
  })
}

// ── 그룹 ────────────────────────────────────────────────────────────────────

test('그룹: 나가기는 시스템 메시지를 먼저 남기고 rev를 올린다. 남은 멤버의 membership_rev가 오른다', async () => {
  const p = [await seedPerson(), await seedPerson(), await seedPerson()]
  const id = crypto.randomUUID()
  await Q.channels.createGroupRow({ id, creatorId: p[0], memberIds: p, title: null })
  const before = await Q.sync.getMembershipRev(p[1])
  const r0 = await channelRev(id)
  await Q.channels.leaveGroupRow({ channelId: id, userId: p[2], systemBody: 'p2님이 나갔습니다.' })
  assert.equal((await channelRev(id)).rev, r0.rev + 1)
  assert.ok((await Q.sync.getMembershipRev(p[1])) > before)
  const sys = await setupClient.execute({
    sql: "select kind, author_id from work_messages where channel_id = ? and kind = 'system'",
    args: [id],
  })
  assert.equal(sys.rows.length, 1)
  assert.deepEqual(
    await Q.channels.getGroupMemberIds(id).then(ids => ids.sort()),
    [p[0], p[1]].sort()
  )
})

// ── 작성자 멤버십(트랜잭션 안) ────────────────────────────────────────────────

// 독립 권한 검토(2026-11-02): 원본 messages_insert는 is_channel_member를 쓰는 문장 안에서 봤다. action이 먼저
// 판정해도 그 사이 멤버십이 빠질 수 있어, 쓰기 트랜잭션 안에서 한 번 더 본다.
test('insertMessage·insertForwardedMessage: 채널 멤버가 아니면 forbidden, 멤버면 된다(짝)', async () => {
  const owner = await seedPerson()
  const outsider = await seedPerson()
  const ch = await seedChannel({ creatorId: owner })
  await assert.rejects(
    Q.messages.insertMessage({
      id: crypto.randomUUID(),
      channelId: ch,
      authorId: outsider,
      body: '멤버 아님',
      canPostRestricted: false,
    }),
    e => e.code === 'forbidden'
  )
  const src = await send(ch, owner, '원본')
  await assert.rejects(
    Q.messages.insertForwardedMessage({
      id: crypto.randomUUID(),
      channelId: ch,
      authorId: outsider,
      body: '',
      forwardedFromId: src,
      sensitive: false,
      canPostRestricted: false,
    }),
    e => e.code === 'forbidden'
  )
  await Q.channels.addChannelMemberRows(ch, [outsider])
  await send(ch, outsider, '이제 멤버')
})
