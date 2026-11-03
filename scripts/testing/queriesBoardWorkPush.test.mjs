import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 이사회 업무툴 5단계(푸시·다이제스트·정리 크론) 쿼리 계층을 실제 SQLite 파일 DB로 검증한다.
 * 원본 kosmart-work는 RPC `push_recipients`·`digest_candidates`와 service_role 쿼리였다. ggac에는 RLS가 없으므로
 * "읽을 수 없는 내용이 수신자·메일·삭제 대상에 들어가지 않는다"를 여기서 못박는다.
 * 권한 판정(canAccessBoardRoom)은 라우트·notify.ts 몫이라 여기서는 같은 규칙을 시험 쪽에서 그대로 적어 넘긴다.
 */

const DB_PATH = 'scripts/testing/.queries-board-work-push-test.db'
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
    channels: await import(src('db/queries/work/channels.ts')),
    messages: await import(src('db/queries/work/messages.ts')),
    prefs: await import(src('db/queries/work/prefs.ts')),
    push: await import(src('db/queries/work/push.ts')),
    digest: await import(src('db/queries/work/digest.ts')),
    cleanup: await import(src('db/queries/work/cleanup.ts')),
    cron: await import(src('db/queries/work/cron.ts')),
    recipients: await import(src('work/lib/push/recipients.ts')),
    select: await import(src('work/lib/digest/select.ts')),
  }
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

/** 시험 쪽에 적은 이사회 권한 규칙(src/lib/server/authz.ts canAccessBoardRoom과 같다) */
const canAccessBoardRoom = p =>
  !!p &&
  p.registration_status === 'approved' &&
  p.is_active === true &&
  (p.is_director === true || p.is_admin === true || p.is_auditor === true)

let counter = 0
async function seedPerson(flags = { is_director: true }) {
  const id = crypto.randomUUID()
  await Q.profiles.upsertProfile({
    id,
    email: `bwp-${++counter}@test.local`,
    display_name: `이사${counter}`,
    registration_status: 'approved',
    is_active: true,
    ...flags,
  })
  return id
}

async function seedChannel({ kind = 'public', creatorId }) {
  const id = crypto.randomUUID()
  const label = `채널-${id.slice(0, 8)}`
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

async function send(channelId, authorId, body, extra = {}) {
  const id = crypto.randomUUID()
  const r = await Q.messages.insertMessage({
    id,
    channelId,
    authorId,
    body,
    canPostRestricted: true,
    ...extra,
  })
  assert.equal(r.status, 'created')
  return id
}

async function exec(sql, args = []) {
  return setupClient.execute({ sql, args })
}

const ENDPOINT = n => `https://fcm.googleapis.com/fcm/send/${n}`

// ── 구독 ─────────────────────────────────────────────────────────────────────

test('구독: endpoint 유일 upsert · 주인 조회 · 내 것만 해지 · 내 것 확인', async () => {
  const a = await seedPerson()
  const b = await seedPerson()
  const ep = ENDPOINT(crypto.randomUUID())
  await Q.push.upsertPushSubscription({
    userId: a,
    endpoint: ep,
    p256dh: 'p',
    auth: 'x',
    userAgent: null,
  })
  assert.equal((await Q.push.findPushSubscriptionOwner(ep)).userId, a)
  assert.equal(await Q.push.isMyPushSubscription(a, ep), true)
  assert.equal(await Q.push.isMyPushSubscription(b, ep), false)
  // 남의 endpoint 해지는 0행(라우트가 b의 세션으로 a의 endpoint를 보내도 지워지지 않는다)
  assert.equal(await Q.push.deleteMyPushSubscription(b, ep), 0)
  assert.equal(await Q.push.isMyPushSubscription(a, ep), true)
  // 같은 endpoint 다시 저장 — 행은 하나, 키 갱신
  await Q.push.upsertPushSubscription({
    userId: a,
    endpoint: ep,
    p256dh: 'p2',
    auth: 'x2',
    userAgent: 'UA',
  })
  const rows = await Q.push.listPushSubscriptionsFor([a])
  assert.equal(rows.filter(r => r.endpoint === ep).length, 1)
  assert.equal(rows.find(r => r.endpoint === ep).p256dh, 'p2')
  assert.equal(await Q.push.deleteMyPushSubscription(a, ep), 1)
  assert.equal(await Q.push.findPushSubscriptionOwner(ep), null)
})

test('구독 정리: last_seen_at이 기준보다 이른 것만 지우고, 발송 성공(touch)한 구독은 남는다', async () => {
  const a = await seedPerson()
  const oldEp = ENDPOINT(`old-${crypto.randomUUID()}`)
  const freshEp = ENDPOINT(`fresh-${crypto.randomUUID()}`)
  const now = new Date('2026-11-04T00:00:00Z')
  const d91 = new Date(now.getTime() - 91 * 86400_000)
  await Q.push.upsertPushSubscription({
    userId: a,
    endpoint: oldEp,
    p256dh: 'p',
    auth: 'x',
    userAgent: null,
    now: d91,
  })
  await Q.push.upsertPushSubscription({
    userId: a,
    endpoint: freshEp,
    p256dh: 'p',
    auth: 'x',
    userAgent: null,
    now: d91,
  })
  const fresh = (await Q.push.listPushSubscriptionsFor([a])).find(r => r.endpoint === freshEp)
  await Q.push.touchPushSubscriptions([fresh.id], now)
  const removed = await Q.push.deleteStalePushSubscriptions(
    new Date(now.getTime() - 90 * 86400_000)
  )
  assert.ok(removed >= 1)
  assert.equal(await Q.push.findPushSubscriptionOwner(oldEp), null)
  assert.equal((await Q.push.findPushSubscriptionOwner(freshEp)).userId, a)
  // 만료(404·410) 삭제
  assert.equal(await Q.push.deletePushSubscriptionsByIds([fresh.id]), 1)
})

// ── 수신자 후보 ───────────────────────────────────────────────────────────────

const NOON = new Date('2026-11-04T03:00:00Z') // 서울 수요일 정오

async function recipients(messageId, reason) {
  const found = await Q.push.listPushCandidates(messageId, reason)
  if (!found) return null
  return Q.recipients
    .selectPushRecipients({
      reason,
      message: found.message,
      candidates: found.candidates,
      canAccess: c => canAccessBoardRoom(c.profile),
      now: NOON,
    })
    .sort()
}

test('멘션 푸시: 멘션된 멤버만 — 작성자·멘션 안 된 사람 제외, 뮤트(끔)·이사 해임·방해 금지는 빠진다', async () => {
  const author = await seedPerson()
  const target = await seedPerson()
  const muted = await seedPerson()
  const fired = await seedPerson()
  const sleeper = await seedPerson()
  const bystander = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  await Q.channels.addChannelMemberRows(ch, [target, muted, fired, sleeper, bystander])
  await Q.channels.setNotifyLevelRow(ch, muted, 'off')
  await Q.prefs.upsertMemberPrefs(sleeper, {
    quietEnabled: true,
    quietStart: 600,
    quietEnd: 780,
    quietWeekends: false,
  })
  const msg = await send(ch, author, '안건')
  await Q.messages.recordMentionRows({
    messageId: msg,
    authorId: author,
    explicitIds: [target, muted, fired, sleeper, author],
    everyone: false,
  })
  // 이사에서 빠짐 — 멤버십·멘션 행은 남아 있다
  await exec('update member_profiles set is_director = 0 where id = ?', [fired])
  assert.deepEqual(await recipients(msg, 'mention'), [target].sort())
})

test('읽기 범위: 비공개 채널에서 나간 사람은 멘션 행이 남아도 받지 않는다(멤버만)', async () => {
  const owner = await seedPerson()
  const leaver = await seedPerson()
  const stayer = await seedPerson()
  const ch = await seedChannel({ kind: 'private', creatorId: owner })
  await Q.channels.addChannelMemberRows(ch, [leaver, stayer])
  const msg = await send(ch, owner, '비공개 안건')
  await Q.messages.recordMentionRows({
    messageId: msg,
    authorId: owner,
    explicitIds: [leaver, stayer],
    everyone: false,
  })
  await exec('delete from work_channel_members where channel_id = ? and user_id = ?', [ch, leaver])
  const found = await Q.push.listPushCandidates(msg, 'mention')
  const leaverRow = found.candidates.find(c => c.userId === leaver)
  assert.equal(leaverRow.memberRole, null)
  assert.deepEqual(await recipients(msg, 'mention'), [stayer])
})

test('DM 푸시: 상대만(작성자 제외), 끔이면 없음 · 채널 글에 dm 사유는 아무도 없음', async () => {
  const a = await seedPerson()
  const b = await seedPerson()
  const { id: dm } = await Q.channels.openDmRow({
    key: [a, b].sort().join(':'),
    creatorId: a,
    memberIds: [a, b],
  })
  const msg = await send(dm, a, '안녕하세요')
  assert.deepEqual(await recipients(msg, 'dm'), [b])
  await Q.channels.setNotifyLevelRow(dm, b, 'off')
  assert.deepEqual(await recipients(msg, 'dm'), [])
  const ch = await seedChannel({ creatorId: a })
  const chMsg = await send(ch, a, '채널 글')
  assert.deepEqual(await recipients(chMsg, 'dm'), [])
})

test('스레드 푸시: 부모 작성자 + 답글 작성자(지운 답글의 작성자는 제외), 멘션된 사람은 제외', async () => {
  const parentAuthor = await seedPerson()
  const replier = await seedPerson()
  const deletedReplier = await seedPerson()
  const mentioned = await seedPerson()
  const newcomer = await seedPerson()
  const ch = await seedChannel({ creatorId: parentAuthor })
  await Q.channels.addChannelMemberRows(ch, [replier, deletedReplier, mentioned, newcomer])
  const parent = await send(ch, parentAuthor, '부모')
  await send(ch, replier, '답1', { parentId: parent })
  await send(ch, mentioned, '답2', { parentId: parent })
  const gone = await send(ch, deletedReplier, '답3', { parentId: parent })
  await Q.messages.softDeleteMessage({
    messageId: gone,
    actorId: deletedReplier,
    actorIsAdmin: false,
  })
  const reply = await send(ch, newcomer, '새 답글', { parentId: parent })
  await Q.messages.recordMentionRows({
    messageId: reply,
    authorId: newcomer,
    explicitIds: [mentioned],
    everyone: false,
  })
  assert.deepEqual(await recipients(reply, 'thread'), [parentAuthor, replier].sort())
})

test('채널 새 글: 모든 새 글(all)인 멤버만 · 지운 메시지는 후보 자체가 없다(null)', async () => {
  const author = await seedPerson()
  const watcher = await seedPerson()
  const normal = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  await Q.channels.addChannelMemberRows(ch, [watcher, normal])
  await Q.channels.setNotifyLevelRow(ch, watcher, 'all')
  const msg = await send(ch, author, '공지')
  assert.deepEqual(await recipients(msg, 'channel'), [watcher])
  assert.equal(await Q.messages.hasAllLevelWatcher(ch, author), true)
  await Q.messages.softDeleteMessage({ messageId: msg, actorId: author, actorIsAdmin: false })
  assert.equal(await Q.push.listPushCandidates(msg, 'channel'), null)
  assert.equal(await Q.push.loadPushMessageInfo(msg), null)
})

test('푸시 본문 원자료: 작성자 이름·채널·민감 여부만 읽는다', async () => {
  const author = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  const msg = await send(ch, author, '본문')
  const info = await Q.push.loadPushMessageInfo(msg)
  assert.equal(info.channelId, ch)
  assert.equal(info.channelKind, 'public')
  assert.equal(info.sensitive, false)
  assert.match(info.authorName, /^이사\d+$/)
})

// ── 다이제스트 후보 ───────────────────────────────────────────────────────────

const DNOW = new Date('2026-11-04T03:00:00Z')
const minAgo = m => new Date(DNOW.getTime() - m * 60_000)

async function backdate(messageId, at) {
  await exec('update work_messages set created_at = ? where id = ?', [at.getTime(), messageId])
}
async function setLastRead(channelId, userId, at) {
  await exec(
    'update work_channel_members set last_read_at = ? where channel_id = ? and user_id = ?',
    [at.getTime(), channelId, userId]
  )
}

async function digestFor(userId) {
  const raw = await Q.digest.listDigestCandidates({
    cutoff: new Date(DNOW.getTime() - 10 * 60_000),
    defaultSince: new Date(DNOW.getTime() - 24 * 3600_000),
  })
  const selected = Q.select.selectDigestRows({
    rows: raw,
    now: DNOW,
    canAccess: r => canAccessBoardRoom(r.recipient_profile) && r.recipient_member_role !== null,
  })
  return selected.filter(r => r.recipient_id === userId)
}

test('다이제스트: 안 읽은 멘션·DM만, digest_mode가 꺼져 있으면(기본) 아무것도 없다', async () => {
  const author = await seedPerson()
  const me = await seedPerson()
  const ch = await seedChannel({ creatorId: author })
  await Q.channels.addChannelMemberRows(ch, [me])
  await setLastRead(ch, me, minAgo(600))
  const m1 = await send(ch, author, '멘션1')
  await Q.messages.recordMentionRows({
    messageId: m1,
    authorId: author,
    explicitIds: [me],
    everyone: false,
  })
  await backdate(m1, minAgo(30))
  const { id: dm } = await Q.channels.openDmRow({
    key: [author, me].sort().join(':'),
    creatorId: author,
    memberIds: [author, me],
  })
  await setLastRead(dm, me, minAgo(600))
  const d1 = await send(dm, author, 'DM1')
  await backdate(d1, minAgo(20))

  // 기본(off) — 행이 없으면 끔
  assert.deepEqual(await digestFor(me), [])
  await Q.prefs.upsertMemberPrefs(me, { digestMode: 'normal' })
  const got = await digestFor(me)
  assert.deepEqual(
    got.map(r => [r.kind, r.message_id]),
    [
      ['mention', m1],
      ['dm', d1],
    ]
  )
  assert.match(got[0].recipient_email, /@test\.local$/)
})

test('다이제스트: 읽음·지운 글·본인 글·10분 안·마지막 발송 이전은 빠진다', async () => {
  const author = await seedPerson()
  const me = await seedPerson()
  await Q.prefs.upsertMemberPrefs(me, { digestMode: 'normal' })
  const ch = await seedChannel({ creatorId: author })
  await Q.channels.addChannelMemberRows(ch, [me])
  await setLastRead(ch, me, minAgo(600))
  const mk = async (ago, who = author) => {
    const id = await send(ch, who, `글-${ago}`)
    if (who !== me) {
      await Q.messages.recordMentionRows({
        messageId: id,
        authorId: who,
        explicitIds: [me],
        everyone: false,
      })
    }
    await backdate(id, minAgo(ago))
    return id
  }
  const tooNew = await mk(5)
  const deleted = await mk(40)
  await Q.messages.softDeleteMessage({ messageId: deleted, actorId: author, actorIsAdmin: false })
  const beforeState = await mk(300)
  const ok = await mk(60)
  await mk(50, me) // 본인 글
  const readOne = await mk(45)
  await exec('update work_mentions set read_at = ? where message_id = ? and user_id = ?', [
    DNOW.getTime(),
    readOne,
    me,
  ])
  await Q.digest.upsertDigestState(me, minAgo(200))
  const ids = (await digestFor(me)).map(r => r.message_id)
  assert.deepEqual(ids, [ok])
  for (const x of [tooNew, deleted, beforeState, readOne]) assert.equal(ids.includes(x), false)
  assert.equal((await Q.digest.getDigestState(me)).getTime(), minAgo(200).getTime())
})

test('다이제스트: 읽을 수 없는 내용은 없다 — 채널에서 나간 뒤의 멘션, 이사에서 빠진 사람', async () => {
  const owner = await seedPerson()
  const leaver = await seedPerson()
  const fired = await seedPerson()
  for (const u of [leaver, fired]) await Q.prefs.upsertMemberPrefs(u, { digestMode: 'normal' })
  const ch = await seedChannel({ kind: 'private', creatorId: owner })
  await Q.channels.addChannelMemberRows(ch, [leaver, fired])
  for (const u of [leaver, fired]) await setLastRead(ch, u, minAgo(600))
  const msg = await send(ch, owner, '비공개 안건')
  await Q.messages.recordMentionRows({
    messageId: msg,
    authorId: owner,
    explicitIds: [leaver, fired],
    everyone: false,
  })
  await backdate(msg, minAgo(30))
  // 짝: 나가기 전·해임 전에는 둘 다 받는다
  assert.equal((await digestFor(leaver)).length, 1)
  assert.equal((await digestFor(fired)).length, 1)
  await exec('delete from work_channel_members where channel_id = ? and user_id = ?', [ch, leaver])
  await exec('update member_profiles set is_director = 0 where id = ?', [fired])
  assert.deepEqual(await digestFor(leaver), [])
  assert.deepEqual(await digestFor(fired), [])
})

test('다이제스트: DM에서 멘션된 글은 멘션 갈래에만(중복 없음), DM 알림이 모든 새 글이 아니면 DM 갈래 없음', async () => {
  const a = await seedPerson()
  const me = await seedPerson()
  await Q.prefs.upsertMemberPrefs(me, { digestMode: 'hourly' })
  const { id: dm } = await Q.channels.openDmRow({
    key: [a, me].sort().join(':'),
    creatorId: a,
    memberIds: [a, me],
  })
  await setLastRead(dm, me, minAgo(600))
  const m = await send(dm, a, '멘션 DM')
  await Q.messages.recordMentionRows({
    messageId: m,
    authorId: a,
    explicitIds: [me],
    everyone: false,
  })
  await backdate(m, minAgo(90))
  const plain = await send(dm, a, '그냥 DM')
  await backdate(plain, minAgo(30)) // hourly: 60분 안 → 아직
  const rows = await digestFor(me)
  assert.deepEqual(
    rows.map(r => [r.kind, r.message_id]),
    [['mention', m]]
  )
  await Q.channels.setNotifyLevelRow(dm, me, 'mentions')
  await backdate(plain, minAgo(120))
  assert.deepEqual(
    (await digestFor(me)).map(r => r.kind),
    ['mention']
  )
})

// ── 정리 크론 ─────────────────────────────────────────────────────────────────

async function seedPending({ uploader, channel, ageHours, blobPath, draft = false }) {
  const id = crypto.randomUUID()
  const path = blobPath ?? `board-work/files/${id}/file.pdf`
  await exec(
    'insert into work_pending_uploads (id, channel_id, uploader_id, blob_path, name, mime, size, draft_meta, created_at) values (?,?,?,?,?,?,?,?,?)',
    [
      id,
      channel,
      uploader,
      path,
      'file.pdf',
      'application/pdf',
      10,
      draft ? '{"kind":"draft"}' : null,
      Date.now() - ageHours * 3600_000,
    ]
  )
  return { id, path }
}

test('임시 업로드 정리: 24시간 넘은 것만(오래된 순), 행 삭제는 지정한 것만', async () => {
  const u = await seedPerson()
  const ch = await seedChannel({ creatorId: u })
  const old1 = await seedPending({ uploader: u, channel: ch, ageHours: 30 })
  const old2 = await seedPending({ uploader: u, channel: ch, ageHours: 25, draft: true })
  const fresh = await seedPending({ uploader: u, channel: ch, ageHours: 23 })
  const before = new Date(Date.now() - 24 * 3600_000)
  const rows = await Q.cleanup.listStalePendingUploads(before, 100)
  const ids = rows.map(r => r.id)
  assert.ok(ids.includes(old1.id) && ids.includes(old2.id))
  assert.equal(ids.includes(fresh.id), false)
  assert.ok(ids.indexOf(old1.id) < ids.indexOf(old2.id))
  assert.equal(rows.find(r => r.id === old2.id).isDraft, true)
  assert.equal(await Q.cleanup.deletePendingUploadRows([old1.id]), 1)
  assert.equal(
    (await Q.cleanup.listStalePendingUploads(before, 100)).some(r => r.id === old1.id),
    false
  )
  // 남은 행이 가리키는 키는 "참조됨"
  const ref = await Q.cleanup.findReferencedBlobPaths([
    old1.path,
    old2.path,
    fresh.path,
    'board-work/files/x/none',
  ])
  assert.deepEqual([...ref].sort(), [old2.path, fresh.path].sort())
})

async function seedAttachment({
  messageId,
  channelId,
  uploader,
  versionRootId = null,
  versionNo = 1,
}) {
  const id = crypto.randomUUID()
  const up = crypto.randomUUID()
  const path = `board-work/files/${up}/doc.hwp`
  await exec(
    'insert into work_attachments (id, message_id, channel_id, uploader_id, blob_path, name, mime, size, version_root_id, version_no, is_latest) values (?,?,?,?,?,?,?,?,?,?,1)',
    [
      id,
      messageId,
      channelId,
      uploader,
      path,
      'doc.hwp',
      'application/x-hwp',
      10,
      versionRootId,
      versionNo,
    ]
  )
  return { id, path }
}

async function deleteAt(messageId, at) {
  await exec('update work_messages set deleted_at = ? where id = ?', [at.getTime(), messageId])
}

test('삭제 메시지 정리: 30일 지난 것만, 커서로 건너뛰며, 살아 있는 답글·살아 있는 버전은 남긴다', async () => {
  const u = await seedPerson()
  const ch = await seedChannel({ creatorId: u })
  const now = new Date()
  const d31 = new Date(now.getTime() - 31 * 86400_000)
  const d29 = new Date(now.getTime() - 29 * 86400_000)
  const before = new Date(now.getTime() - 30 * 86400_000)

  const oldGone = await send(ch, u, '오래 전 삭제')
  const recentGone = await send(ch, u, '최근 삭제')
  const live = await send(ch, u, '살아 있음')
  const withReply = await send(ch, u, '답글 있는 부모')
  await send(ch, u, '살아 있는 답글', { parentId: withReply })
  const lineageOld = await send(ch, u, 'v1 메시지')
  const lineageNew = await send(ch, u, 'v2 메시지')
  const v1 = await seedAttachment({ messageId: lineageOld, channelId: ch, uploader: u })
  await seedAttachment({
    messageId: lineageNew,
    channelId: ch,
    uploader: u,
    versionRootId: v1.id,
    versionNo: 2,
  })
  const att = await seedAttachment({ messageId: oldGone, channelId: ch, uploader: u })
  for (const id of [oldGone, withReply, lineageOld]) await deleteAt(id, d31)
  await deleteAt(recentGone, d29)

  const cand = await Q.cleanup.listPurgeCandidates({ before, cursor: null, limit: 1000 })
  const ids = cand.map(c => c.id)
  for (const x of [oldGone, withReply, lineageOld]) assert.ok(ids.includes(x))
  for (const x of [recentGone, live]) assert.equal(ids.includes(x), false)
  // 커서: 첫 행 뒤부터
  const after1 = await Q.cleanup.listPurgeCandidates({
    before,
    cursor: { deletedAt: cand[0].deletedAt, id: cand[0].id },
    limit: 1000,
  })
  assert.equal(
    after1.some(c => c.id === cand[0].id),
    false
  )

  const blocked = await Q.cleanup.listParentsWithLiveReplies([oldGone, withReply, lineageOld])
  assert.deepEqual([...blocked], [withReply])

  const atts = await Q.cleanup.listPurgeAttachments([oldGone, lineageOld])
  assert.deepEqual(
    atts.map(a => [a.id, a.top]).sort(),
    [
      [att.id, oldGone],
      [v1.id, lineageOld],
    ].sort()
  )
  for (const a of atts) assert.ok(a.blobPath.startsWith('board-work/files/'))
  const liveRoots = await Q.cleanup.listRootsWithLiveVersions(
    atts.map(a => a.root),
    new Set([oldGone, lineageOld])
  )
  assert.deepEqual([...liveRoots], [v1.id])

  // 영구 삭제는 소프트 삭제된 것만 — 살아 있는 글 id를 섞어도 지우지 않는다
  assert.equal(await Q.cleanup.hardDeleteMessages([oldGone, live]), 1)
  const left = await exec('select id from work_messages where id in (?, ?)', [oldGone, live])
  assert.deepEqual(
    left.rows.map(r => r.id),
    [live]
  )
  const attLeft = await exec('select count(*) as n from work_attachments where id = ?', [att.id])
  assert.equal(Number(attLeft.rows[0].n), 0) // FK cascade
})

// ── 크론 장부 ─────────────────────────────────────────────────────────────────

test('크론 장부: 시작은 running, 성공은 ok + 성공 시각, 실패는 failed(성공 시각 유지)', async () => {
  const t1 = new Date('2026-11-04T00:00:00Z')
  const t2 = new Date('2026-11-04T00:01:00Z')
  await Q.cron.markCronStarted('push-cleanup', t1)
  let row = (await Q.cron.listCronRuns()).find(r => r.job === 'push-cleanup')
  assert.equal(row.last_status, 'running')
  await Q.cron.markCronFinished('push-cleanup', true, t2)
  row = (await Q.cron.listCronRuns()).find(r => r.job === 'push-cleanup')
  assert.equal(row.last_status, 'ok')
  assert.equal(row.last_succeeded_at, t2.toISOString())
  await Q.cron.markCronStarted('push-cleanup', t2)
  await Q.cron.markCronFinished('push-cleanup', false, t2)
  row = (await Q.cron.listCronRuns()).find(r => r.job === 'push-cleanup')
  assert.equal(row.last_status, 'failed')
  assert.equal(row.last_succeeded_at, t2.toISOString())
})
