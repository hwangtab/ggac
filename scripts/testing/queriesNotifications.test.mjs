import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/notifications.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesLikes.test.mjs`(Task 6)와 동일.
 *
 * 이 스위트의 핵심은 단계 2b-5 회귀(`markAllNotificationsRead`가
 * `user_id` 필터를 잃으면 다른 회원의 알림까지 읽음 처리된다)가 다시 들어오지
 * 않는지다 — 여러 사용자의 알림을 함께 심고, 그중 하나만 대상이어야 한다는
 * 것을 매번 직접 확인한다(오라클은 이 모듈이 아니라 `setupClient` 원시
 * 쿼리로 구한다).
 */

const DB_PATH = 'scripts/testing/.queries-notifications-test.db'
const NOTIFICATIONS_MODULE_URL = new URL('../../src/db/queries/notifications.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshNotificationsModule() {
  return import(`${NOTIFICATIONS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshProfilesModule() {
  return import(`${PROFILES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

// ---------------------------------------------------------------- 부정 대조: 깨진 경로

test('부정 대조 기반: markAllNotificationsRead가 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { markAllNotificationsRead } = await loadFreshNotificationsModule()
    await assert.rejects(() => markAllNotificationsRead('any-user'))
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0

async function seedProfile(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `notif-profile-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: overrides.display_name ?? '알림테스트회원',
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

async function seedNotification(overrides = {}) {
  const { createNotification } = await loadFreshNotificationsModule()
  const userId = overrides.userId ?? (await seedProfile())
  const id = await createNotification({
    user_id: userId,
    type: overrides.type ?? 'system_notice',
    title: overrides.title ?? '알림 제목',
    message: overrides.message ?? '알림 본문',
    data: overrides.data,
    related_post_id: overrides.relatedPostId ?? null,
    related_user_id: overrides.relatedUserId ?? null,
    expires_at: overrides.expiresAt ?? null,
  })
  if (overrides.readAt) {
    await setupClient.execute({
      sql: 'UPDATE notifications SET read_at = ? WHERE id = ?',
      args: [overrides.readAt.getTime(), id],
    })
  }
  return { id, userId, readAt: overrides.readAt ?? null }
}

async function getNotificationRaw(id) {
  const result = await setupClient.execute({
    sql: 'SELECT * FROM notifications WHERE id = ?',
    args: [id],
  })
  return result.rows[0] ?? null
}

async function countNotificationsRaw(userId) {
  const result = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?',
    args: [userId],
  })
  return Number(result.rows[0].c)
}

let sharedUserId
test('사전 준비: 공통 사용자를 심는다', async () => {
  sharedUserId = await seedProfile({ id: 'notif-user-common', display_name: '공통사용자' })
  assert.ok(sharedUserId)
})

// ------------------------------------------------------------- createNotification

test('createNotification: notifications에 INSERT하고 id를 반환한다', async () => {
  const { createNotification } = await loadFreshNotificationsModule()
  const id = await createNotification({
    user_id: sharedUserId,
    type: 'welcome',
    title: '환영합니다',
    message: '가입을 축하합니다',
  })
  assert.ok(id)
  const row = await getNotificationRaw(id)
  assert.ok(row, 'DB에 실제로 삽입돼야 한다')
  assert.equal(row.user_id, sharedUserId)
  assert.equal(row.type, 'welcome')
  assert.equal(row.title, '환영합니다')
  assert.equal(row.message, '가입을 축하합니다')
  assert.equal(row.data, '{}', 'data는 NOT NULL이라 기본값 {}가 채워져야 한다')
  assert.equal(row.read_at, null)
})

test('createNotification: data(jsonb였던 컬럼)를 객체 그대로 왕복한다 — text(mode:json) 직렬화가 형태를 바꾸지 않는다', async () => {
  const { createNotification, listNotifications } = await loadFreshNotificationsModule()
  const payload = { post_title: '게시글 제목', nested: { a: 1, b: [1, 2, 3] } }
  const id = await createNotification({
    user_id: sharedUserId,
    type: 'post_reply',
    title: '댓글 알림',
    message: '누가 댓글을 달았습니다',
    data: payload,
  })
  const { rows } = await listNotifications(sharedUserId, { page: 1, limit: 50 })
  const found = rows.find(r => r.id === id)
  assert.ok(found)
  assert.deepEqual(found.data, payload, 'data는 쓴 그대로 객체로 읽혀야 한다')
})

test('createNotification: related_post_id/related_user_id/expires_at을 그대로 저장한다', async () => {
  const { createNotification } = await loadFreshNotificationsModule()
  const relatedUser = await seedProfile()
  const expiresAt = new Date(Date.now() + 86400000).toISOString()
  const id = await createNotification({
    user_id: sharedUserId,
    type: 'post_mention',
    title: '멘션',
    message: '누가 회원님을 멘션했습니다',
    related_post_id: 'some-post-id',
    related_user_id: relatedUser,
    expires_at: expiresAt,
  })
  const row = await getNotificationRaw(id)
  assert.equal(row.related_post_id, 'some-post-id')
  assert.equal(row.related_user_id, relatedUser)
  assert.equal(new Date(Number(row.expires_at)).toISOString(), expiresAt)
})

test('createNotification: 존재하지 않는 user_id는 FK 위반으로 거부된다', async () => {
  const { createNotification } = await loadFreshNotificationsModule()
  await assert.rejects(
    () =>
      createNotification({
        user_id: 'ghost-user-nope',
        type: 'system_notice',
        title: '제목',
        message: '본문',
      }),
    err => {
      const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
      return /FOREIGN KEY|FOREIGNKEY/.test(combined)
    }
  )
})

// ---------------------------------------------------------- createBulkNotifications

test('createBulkNotifications: 여러 사용자에게 같은 알림을 삽입하고 삽입 건수를 반환한다', async () => {
  const { createBulkNotifications } = await loadFreshNotificationsModule()
  const u1 = await seedProfile()
  const u2 = await seedProfile()
  const u3 = await seedProfile()

  const count = await createBulkNotifications({
    user_ids: [u1, u2, u3],
    type: 'board_notice',
    title: '이사회 공지',
    message: '정기 이사회가 열립니다',
    data: { scope: 'board-room' },
  })

  assert.equal(count, 3)
  assert.equal(await countNotificationsRaw(u1), 1)
  assert.equal(await countNotificationsRaw(u2), 1)
  assert.equal(await countNotificationsRaw(u3), 1)

  const result = await setupClient.execute({
    sql: 'SELECT title, message, type, data FROM notifications WHERE user_id = ?',
    args: [u2],
  })
  assert.equal(result.rows[0].title, '이사회 공지')
  assert.equal(result.rows[0].type, 'board_notice')
  assert.equal(result.rows[0].data, '{"scope":"board-room"}')
})

test('createBulkNotifications: user_ids가 비면 쿼리 없이 0을 반환한다', async () => {
  const { createBulkNotifications } = await loadFreshNotificationsModule()
  const count = await createBulkNotifications({
    user_ids: [],
    type: 'system_notice',
    title: '제목',
    message: '본문',
  })
  assert.equal(count, 0)
})

test('createBulkNotifications: 존재하지 않는 user_id가 섞이면 전체가 FK 위반으로 거부된다(부분 삽입 없음)', async () => {
  const { createBulkNotifications } = await loadFreshNotificationsModule()
  const real = await seedProfile()
  const before = await countNotificationsRaw(real)
  await assert.rejects(() =>
    createBulkNotifications({
      user_ids: [real, 'ghost-user-nope'],
      type: 'system_notice',
      title: '제목',
      message: '본문',
    })
  )
  assert.equal(
    await countNotificationsRaw(real),
    before,
    '한 문장 INSERT이므로 실패 시 부분 삽입이 남지 않아야 한다'
  )
})

// 소스 가드 — createBulkNotifications가 사용자마다 도는 루프로 되돌아가면 잡는다.
test('createBulkNotifications 구현은 배치 INSERT 한 번이다 — user_ids를 도는 루프로 삽입하면 안 된다 (소스 가드)', () => {
  const src = readFileSync('src/db/queries/notifications.ts', 'utf8')
  const match = src.match(/export async function createBulkNotifications\([\s\S]*?\n\}\n/)
  assert.ok(match, 'createBulkNotifications 함수 본문을 찾지 못했다')
  const body = match[0]

  assert.doesNotMatch(
    body,
    /for\s*\(|while\s*\(|\.forEach\(/,
    'createBulkNotifications는 user_ids를 도는 루프를 쓰면 안 된다 — 배치 INSERT 한 번이어야 한다'
  )
  const insertCalls = body.match(/db\s*\.\s*insert\(/g) ?? []
  assert.equal(insertCalls.length, 1, 'db.insert(...) 호출은 정확히 한 번이어야 한다(배치)')
  assert.match(
    body,
    /\.values\(\s*\n?\s*input\.user_ids\.map\(/,
    'values()에 user_ids.map(...)으로 만든 행 배열을 통째로 넘겨야 한다'
  )
})

// ------------------------------------------------------------- listNotifications

test('listNotifications: user_id로 스코프하고 created_at 내림차순으로 반환한다', async () => {
  const { listNotifications } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  const other = await seedProfile()
  const n1 = await seedNotification({ userId: user, title: '첫번째' })
  await new Promise(r => setTimeout(r, 5))
  const n2 = await seedNotification({ userId: user, title: '두번째' })
  await seedNotification({ userId: other, title: '남의알림' })

  const { rows, total } = await listNotifications(user, { page: 1, limit: 20 })
  assert.equal(total, 2, '다른 사용자의 알림은 세지 않는다')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, n2.id, '최신순(created_at desc)이어야 한다')
  assert.equal(rows[1].id, n1.id)
  assert.ok(
    rows.every(r => r.user_id === user),
    '다른 사용자의 알림이 섞이면 안 된다'
  )
})

test('listNotifications: type 필터가 적용된다', async () => {
  const { listNotifications } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  await seedNotification({ userId: user, type: 'welcome' })
  await seedNotification({ userId: user, type: 'system_notice' })
  await seedNotification({ userId: user, type: 'system_notice' })

  const { rows, total } = await listNotifications(user, {
    page: 1,
    limit: 20,
    type: 'system_notice',
  })
  assert.equal(total, 2)
  assert.ok(rows.every(r => r.type === 'system_notice'))
})

test('listNotifications: unreadOnly 필터가 read_at IS NULL만 남긴다', async () => {
  const { listNotifications } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  await seedNotification({ userId: user })
  await seedNotification({ userId: user, readAt: new Date() })

  const { rows, total } = await listNotifications(user, { page: 1, limit: 20, unreadOnly: true })
  assert.equal(total, 1)
  assert.equal(rows[0].read_at, null)
})

test('listNotifications: unreadCount는 type/unreadOnly 필터와 무관하게 이 사용자의 안 읽은 알림 총수다', async () => {
  const { listNotifications } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  await seedNotification({ userId: user, type: 'welcome' })
  await seedNotification({ userId: user, type: 'system_notice' })
  await seedNotification({ userId: user, type: 'system_notice', readAt: new Date() })

  const { unreadCount } = await listNotifications(user, { page: 1, limit: 20, type: 'welcome' })
  assert.equal(unreadCount, 2, 'type 필터(welcome)와 무관하게 안 읽은 알림 총수(2)여야 한다')
})

test('listNotifications: 마지막 페이지를 넘겨 요청해도 total은 0으로 떨어지지 않는다', async () => {
  const { listNotifications } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  await seedNotification({ userId: user })
  await seedNotification({ userId: user })

  const { rows, total } = await listNotifications(user, { page: 5, limit: 20 })
  assert.equal(rows.length, 0, '이 페이지엔 행이 없어야 한다')
  assert.equal(total, 2, 'total은 별도 COUNT 쿼리라 페이지와 무관하게 정확해야 한다')
})

test('listNotifications: 만료된(expires_at이 과거인) 알림은 목록·total·unreadCount에서 빠진다', async () => {
  const { listNotifications } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  const past = new Date(Date.now() - 1000)
  const { id: expiredId } = await seedNotification({
    userId: user,
    expiresAt: past,
    title: '만료됨',
  })
  const { id: liveId } = await seedNotification({
    userId: user,
    expiresAt: new Date(Date.now() + 86400000),
    title: '아직 안 만료',
  })
  const { id: noExpiryId } = await seedNotification({ userId: user, title: '만료 없음' })

  const { rows, total, unreadCount } = await listNotifications(user, { page: 1, limit: 20 })
  const ids = rows.map(r => r.id)
  assert.ok(!ids.includes(expiredId), '만료된 알림은 목록에 나오면 안 된다')
  assert.ok(ids.includes(liveId), '아직 안 만료된 알림은 나와야 한다')
  assert.ok(ids.includes(noExpiryId), 'expires_at이 NULL(만료 없음)인 알림은 나와야 한다')
  assert.equal(total, 2, 'total도 만료된 1건을 빼야 한다')
  assert.equal(unreadCount, 2, 'unreadCount(배지)도 만료된 안 읽음 알림을 빼야 한다')
})

// ------------------------------------------------------------- getNotificationStats

test('getNotificationStats: FILTER 없이 SUM(CASE)으로 옮긴 집계가 실제 값과 일치한다', async () => {
  const { getNotificationStats } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  await seedNotification({ userId: user })
  await seedNotification({ userId: user })
  await seedNotification({ userId: user, readAt: new Date() })

  const stats = await getNotificationStats(user)
  assert.equal(stats.user_id, user)
  assert.equal(stats.total_notifications, 3)
  assert.equal(stats.unread_count, 2)
  assert.equal(stats.read_count, 1)
  assert.ok(stats.latest_notification_at)
})

test('getNotificationStats: 알림이 하나도 없는 사용자는 0으로 채운 통계를 반환한다(뷰의 GROUP BY라면 행이 아예 없었을 경우)', async () => {
  const { getNotificationStats } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  const stats = await getNotificationStats(user)
  assert.deepEqual(stats, {
    user_id: user,
    total_notifications: 0,
    unread_count: 0,
    read_count: 0,
    latest_notification_at: null,
  })
})

test('getNotificationStats: 집계가 실제로 틀리면(잘못된 카운트) 이 테스트가 잡는다 — 오라클은 raw COUNT', async () => {
  const { getNotificationStats } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  for (let i = 0; i < 4; i++) await seedNotification({ userId: user })
  for (let i = 0; i < 3; i++) await seedNotification({ userId: user, readAt: new Date() })

  const stats = await getNotificationStats(user)
  const rawTotal = await countNotificationsRaw(user)
  assert.equal(stats.total_notifications, rawTotal)
  assert.equal(stats.unread_count + stats.read_count, stats.total_notifications)
  assert.equal(stats.unread_count, 4)
  assert.equal(stats.read_count, 3)
})

test('getNotificationStats: 만료된 알림은 total/unread/read 집계에서 빠진다', async () => {
  const { getNotificationStats } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  const past = new Date(Date.now() - 1000)
  await seedNotification({ userId: user, expiresAt: past, title: '만료된 안읽음' })
  await seedNotification({
    userId: user,
    expiresAt: past,
    readAt: new Date(),
    title: '만료된 읽음',
  })
  await seedNotification({ userId: user, title: '만료 없음' })

  const stats = await getNotificationStats(user)
  assert.equal(stats.total_notifications, 1, '만료된 2건은 집계에서 빠져야 한다')
  assert.equal(stats.unread_count, 1)
  assert.equal(stats.read_count, 0)
})

// ------------------------------------------------------------- markNotificationRead

test('markNotificationRead: 본인의 안 읽은 알림을 읽음 처리하고 갱신된 행을 반환한다', async () => {
  const { markNotificationRead } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  const { id } = await seedNotification({ userId: user })

  const updated = await markNotificationRead(id, user)
  assert.ok(updated)
  assert.ok(updated.read_at)
  const row = await getNotificationRaw(id)
  assert.ok(row.read_at)
})

test('markNotificationRead: 남의 알림은 null을 반환하고 건드리지 않는다', async () => {
  const { markNotificationRead } = await loadFreshNotificationsModule()
  const owner = await seedProfile()
  const attacker = await seedProfile()
  const { id } = await seedNotification({ userId: owner })

  const result = await markNotificationRead(id, attacker)
  assert.equal(result, null)
  const row = await getNotificationRaw(id)
  assert.equal(row.read_at, null, '소유자가 아니면 읽음 처리되면 안 된다')
})

test('markNotificationRead: 이미 읽은 알림은 시각을 덮어쓰지 않는다(null 반환)', async () => {
  const { markNotificationRead } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  const readAt = new Date(Date.now() - 100000)
  const { id } = await seedNotification({ userId: user, readAt })

  const result = await markNotificationRead(id, user)
  assert.equal(result, null, 'read_at IS NULL 조건에 안 걸리므로 갱신 대상이 아니다')
  const row = await getNotificationRaw(id)
  assert.equal(Number(row.read_at), readAt.getTime(), '기존 읽음 시각이 그대로여야 한다')
})

// ------------------------------------------------------------- deleteNotification

test('deleteNotification: 본인 알림을 삭제한다', async () => {
  const { deleteNotification } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  const { id } = await seedNotification({ userId: user })

  await deleteNotification(id, user)
  assert.equal(await getNotificationRaw(id), null)
})

test('deleteNotification: 남의 알림은 삭제되지 않는다(소유권 필터)', async () => {
  const { deleteNotification } = await loadFreshNotificationsModule()
  const owner = await seedProfile()
  const attacker = await seedProfile()
  const { id } = await seedNotification({ userId: owner })

  await deleteNotification(id, attacker)
  assert.ok(await getNotificationRaw(id), '소유자가 아니면 삭제되면 안 된다')
})

// ------------------------------------------------------- markAllNotificationsRead

test('markAllNotificationsRead는 그 사용자의 안 읽은 알림만 읽음 처리한다', async () => {
  const { markAllNotificationsRead } = await loadFreshNotificationsModule()
  const u1 = await seedProfile()
  const u2 = await seedProfile()

  await seedNotification({ userId: u1 })
  await seedNotification({ userId: u1 })
  const other = await seedNotification({ userId: u2 }) // 다른 사용자
  const already = await seedNotification({ userId: u1, readAt: new Date(Date.now() - 50000) })

  const count = await markAllNotificationsRead(u1)
  assert.equal(count, 2, '이미 읽은 것과 남의 것은 세지 않는다')

  const otherRow = await getNotificationRaw(other.id)
  assert.equal(otherRow.read_at, null, '다른 사용자(u2)의 알림은 건드리면 안 된다')

  const alreadyRow = await getNotificationRaw(already.id)
  assert.equal(
    Number(alreadyRow.read_at),
    already.readAt.getTime(),
    '이미 읽은 것의 시각은 바뀌면 안 된다'
  )
})

test('markAllNotificationsRead: 대상이 없으면 0을 반환한다', async () => {
  const { markAllNotificationsRead } = await loadFreshNotificationsModule()
  const user = await seedProfile()
  const count = await markAllNotificationsRead(user)
  assert.equal(count, 0)
})

// 소스 가드 — 소유권 필터·미읽음 조건이 함수 본문에서 사라지면 잡는다(위 행위
// 테스트가 이미 회귀를 잡지만, 이 가드는 "왜 통과했는지"를 코드 자체에서
// 즉시 알 수 있게 한다).
test('markAllNotificationsRead 구현은 user_id 필터와 read_at IS NULL 조건을 모두 갖는다 (소스 가드)', () => {
  const src = readFileSync('src/db/queries/notifications.ts', 'utf8')
  const match = src.match(/export async function markAllNotificationsRead\([\s\S]*?\n\}\n/)
  assert.ok(match, 'markAllNotificationsRead 함수 본문을 찾지 못했다')
  const body = match[0]

  assert.match(
    body,
    /eq\(notifications\.userId,\s*userId\)/,
    'user_id 필터가 없으면 다른 사용자의 알림까지 읽음 처리된다'
  )
  assert.match(
    body,
    /isNull\(notifications\.readAt\)/,
    'read_at IS NULL 조건이 없으면 이미 읽은 알림의 시각이 덮어써진다'
  )
})
