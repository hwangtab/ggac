import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

/**
 * `src/db/queries/sessions.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesNotifications.test.mjs`(단계 2c)와 동일.
 *
 * 핵심 대조:
 * - `manageUserSession`이 활동 기록(로그인/로그아웃) 실패에도 세션 쓰기
 *   결과를 그대로 반환하는가(본 작업을 막지 않는가), 그리고 그 실패가
 *   `onActivityLogError`로 전달되는가(조용히 삼키지 않는가) — 브리프 필수
 *   조건 1번.
 * - `active_users_view` 대체(`listActiveUsers`)가 원본의 INNER JOIN 문제
 *   (신규 회원이 실시간 접속자 패널에서 사라지는 문제)를 재현하지 않는가.
 */

const DB_PATH = 'scripts/testing/.queries-sessions-test.db'
const SESSIONS_MODULE_URL = new URL('../../src/db/queries/sessions.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshSessionsModule() {
  return import(`${SESSIONS_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshProfilesModule() {
  return import(`${PROFILES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await setupClient.executeMultiple(
    readFileSync('src/db/migrations/0000_dizzy_krista_starr.sql', 'utf8')
  )
  await setupClient.executeMultiple(readFileSync('src/db/migrations/0001_neat_exiles.sql', 'utf8'))
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

// ---------------------------------------------------------------- 부정 대조: 깨진 경로

test('부정 대조 기반: manageUserSession(start)이 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { manageUserSession } = await loadFreshSessionsModule()
    await assert.rejects(() =>
      manageUserSession({ user_id: 'any-user', session_token: 'tok', action: 'start' })
    )
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
async function seedProfile(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `session-profile-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: overrides.display_name ?? '세션테스트회원',
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

async function getSessionRaw(id) {
  const result = await setupClient.execute({
    sql: 'SELECT * FROM user_sessions WHERE id = ?',
    args: [id],
  })
  return result.rows[0] ?? null
}

async function countActivitiesRaw(userId, actionType) {
  const result = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM user_activities WHERE user_id = ? AND action_type = ?',
    args: [userId, actionType],
  })
  return Number(result.rows[0].c)
}

// ------------------------------------------------------------- manageUserSession: start

test('manageUserSession(start): 세션을 생성하고 로그인 활동을 기록한다', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const user = await seedProfile()

  const sessionId = await manageUserSession({
    user_id: user,
    session_token: `tok-${user}`,
    action: 'start',
    ip_address: '127.0.0.1',
    user_agent: 'agent',
    metadata: { login_method: 'oauth' },
  })

  assert.ok(sessionId)
  const row = await getSessionRaw(sessionId)
  assert.ok(row)
  assert.equal(row.user_id, user)
  assert.equal(row.is_active, 1)
  assert.equal(await countActivitiesRaw(user, 'login'), 1, '로그인 활동이 기록돼야 한다')
})

test('manageUserSession(start): 기존 활성 세션을 종료하고 새 세션만 활성으로 남긴다', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const user = await seedProfile()

  const first = await manageUserSession({ user_id: user, session_token: 'tok-1', action: 'start' })
  const second = await manageUserSession({ user_id: user, session_token: 'tok-2', action: 'start' })

  const firstRow = await getSessionRaw(first)
  const secondRow = await getSessionRaw(second)
  assert.equal(firstRow.is_active, 0, '이전 세션은 비활성화돼야 한다')
  assert.ok(firstRow.logout_at, '이전 세션은 logout_at이 찍혀야 한다')
  assert.equal(secondRow.is_active, 1, '새 세션만 활성이어야 한다')
})

test('manageUserSession(start): 존재하지 않는 user_id는 FK 위반으로 거부된다(세션도 활동도 남지 않는다)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  await assert.rejects(() =>
    manageUserSession({ user_id: 'ghost-user-nope', session_token: 'tok-ghost', action: 'start' })
  )
  const result = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM user_sessions WHERE session_token = ?',
    args: ['tok-ghost'],
  })
  assert.equal(Number(result.rows[0].c), 0)
})

// ------------------------------------------------------------- manageUserSession: update

test('manageUserSession(update): 활성 세션의 last_activity/metadata를 갱신하고 id를 반환한다', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const user = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: user,
    session_token: 'tok-update',
    action: 'start',
  })

  await new Promise(r => setTimeout(r, 5))
  const result = await manageUserSession({
    user_id: user,
    session_token: 'tok-update',
    action: 'update',
    metadata: { page: '/board' },
  })

  assert.equal(result, sessionId)
  const row = await getSessionRaw(sessionId)
  assert.equal(row.metadata, '{"page":"/board"}')
})

test('manageUserSession(update): 매칭되는 활성 세션이 없으면 null을 반환한다', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const user = await seedProfile()
  const result = await manageUserSession({
    user_id: user,
    session_token: 'no-such-token',
    action: 'update',
  })
  assert.equal(result, null)
})

// ------------------------------------------------------------- manageUserSession: end

test('manageUserSession(end): 세션을 비활성화하고 로그아웃 활동을 기록한다', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const user = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: user,
    session_token: 'tok-end',
    action: 'start',
  })

  const result = await manageUserSession({ user_id: user, session_token: 'tok-end', action: 'end' })
  assert.equal(result, sessionId)
  const row = await getSessionRaw(sessionId)
  assert.equal(row.is_active, 0)
  assert.ok(row.logout_at)
  assert.equal(await countActivitiesRaw(user, 'logout'), 1)
})

test('manageUserSession(end): 매칭되는 활성 세션이 없어도 null을 반환하되 로그아웃 활동은 그대로 기록한다(원본 RPC와 동일한 동작)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const user = await seedProfile()

  const result = await manageUserSession({
    user_id: user,
    session_token: 'no-such-token-2',
    action: 'end',
  })
  assert.equal(result, null)
  assert.equal(
    await countActivitiesRaw(user, 'logout'),
    1,
    '원본 RPC는 session_id가 NULL이어도 로그아웃 활동 기록을 무조건 호출했다'
  )
})

// ------------------------------------------- onActivityLogError: 부정 대조(본 작업 안 막힘)

test('manageUserSession(end): 활동 기록이 실패해도 세션 쓰기는 이미 성공했고, 실패는 onActivityLogError로 전달된다(삼키지 않는다)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const owner = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: owner,
    session_token: 'tok-mismatch',
    action: 'start',
  })

  // end는 session_token으로만 세션을 찾는다(user_id는 활동 기록에만 쓰인다) —
  // 존재하지 않는 user_id를 넘기면 세션 UPDATE는 성공하지만
  // logUserActivity(user_id: ghost)는 FK 위반으로 실패한다. 이 경로가
  // "세션 작업은 성공, 활동 기록만 실패"를 목(mock) 없이 실제 DB로 재현한다.
  const errors = []
  const result = await manageUserSession(
    { user_id: 'ghost-user-nope', session_token: 'tok-mismatch', action: 'end' },
    err => errors.push(err)
  )

  assert.equal(result, sessionId, '세션 종료 자체는 성공해 sessionId를 반환해야 한다')
  const row = await getSessionRaw(sessionId)
  assert.equal(row.is_active, 0, '세션은 실제로 비활성화됐어야 한다(본 작업이 막히지 않았다)')

  assert.equal(errors.length, 1, '활동 기록 실패가 onActivityLogError로 정확히 한 번 전달돼야 한다')
  const combined = `${errors[0]?.message ?? ''} ${errors[0]?.cause?.message ?? ''}`
  assert.match(
    combined,
    /FOREIGN KEY|FOREIGNKEY/,
    '전달된 오류는 실제 FK 위반이어야 한다(조용히 다른 걸로 대체되면 안 된다)'
  )

  // 로그아웃 활동 자체는 트랜잭션 롤백으로 남지 않는다(logUserActivity는
  // user_activities+daily_activity_stats를 한 트랜잭션으로 묶는다).
  assert.equal(await countActivitiesRaw('ghost-user-nope', 'logout'), 0)
})

test('manageUserSession: onActivityLogError를 넘기지 않아도 세션 작업 자체는 여전히 성공한다(기본값은 조용한 무시)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const owner = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: owner,
    session_token: 'tok-noop-cb',
    action: 'start',
  })

  const result = await manageUserSession({
    user_id: 'ghost-user-nope',
    session_token: 'tok-noop-cb',
    action: 'end',
  })
  assert.equal(result, sessionId)
})

// ------------------------------------------------------------- listActiveUsers

test('listActiveUsers: 방금 가입한 신규 회원의 세션도 즉시 나타난다(active_users_view의 INNER JOIN 이월 버그 재현 대조)', async () => {
  const { manageUserSession, listActiveUsers } = await loadFreshSessionsModule()
  const freshMember = await seedProfile({ display_name: '방금가입한신입' })

  await manageUserSession({ user_id: freshMember, session_token: 'tok-fresh', action: 'start' })

  const activeUsers = await listActiveUsers(50)
  const found = activeUsers.find(u => u.user_id === freshMember)
  assert.ok(found, '신규 회원의 세션이 실시간 접속자 목록에서 사라지면 안 된다')
  assert.equal(found.display_name, '방금가입한신입')
  assert.equal(found.session_token, 'tok-fresh')
})

test('listActiveUsers: is_active=false인 세션은 제외된다', async () => {
  const { manageUserSession, listActiveUsers } = await loadFreshSessionsModule()
  const user = await seedProfile()
  await manageUserSession({ user_id: user, session_token: 'tok-inactive', action: 'start' })
  await manageUserSession({ user_id: user, session_token: 'tok-inactive', action: 'end' })

  const activeUsers = await listActiveUsers(50)
  assert.ok(!activeUsers.some(u => u.session_token === 'tok-inactive'))
})

test('listActiveUsers: 30분보다 오래 전 활동한 세션은 제외된다', async () => {
  const { manageUserSession, listActiveUsers } = await loadFreshSessionsModule()
  const user = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: user,
    session_token: 'tok-stale',
    action: 'start',
  })

  await setupClient.execute({
    sql: 'UPDATE user_sessions SET last_activity = ? WHERE id = ?',
    args: [Date.now() - 31 * 60 * 1000, sessionId],
  })

  const activeUsers = await listActiveUsers(50)
  assert.ok(!activeUsers.some(u => u.session_token === 'tok-stale'))
})

test('listActiveUsers: activity_count_today는 오늘 활동만 센다(어제 활동은 제외)', async () => {
  const { manageUserSession, listActiveUsers } = await loadFreshSessionsModule()
  const user = await seedProfile()
  await manageUserSession({ user_id: user, session_token: 'tok-count', action: 'start' })
  // manageUserSession(start)이 이미 오늘자 'login' 활동 1건을 기록했다.

  await setupClient.execute({
    sql: `INSERT INTO user_activities (id, user_id, action_type, metadata, created_at)
          VALUES ('yesterday-activity-1', ?, 'page_viewed', '{}', ?)`,
    args: [user, Date.now() - 25 * 60 * 60 * 1000],
  })

  const activeUsers = await listActiveUsers(50)
  const found = activeUsers.find(u => u.session_token === 'tok-count')
  assert.ok(found)
  assert.equal(found.activity_count_today, 1, '어제 활동은 오늘 카운트에 포함되면 안 된다')
})

test('listActiveUsers: minutes_since_activity가 last_activity로부터 대략 계산된다', async () => {
  const { manageUserSession, listActiveUsers } = await loadFreshSessionsModule()
  const user = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: user,
    session_token: 'tok-minutes',
    action: 'start',
  })
  await setupClient.execute({
    sql: 'UPDATE user_sessions SET last_activity = ? WHERE id = ?',
    args: [Date.now() - 10 * 60 * 1000, sessionId],
  })

  const activeUsers = await listActiveUsers(50)
  const found = activeUsers.find(u => u.session_token === 'tok-minutes')
  assert.ok(found.minutes_since_activity >= 9.9 && found.minutes_since_activity <= 10.5)
})

// ------------------------------------------------------------- listSessions

test('listSessions: loginAfter/userId 필터가 적용된다', async () => {
  const { manageUserSession, listSessions } = await loadFreshSessionsModule()
  const user = await seedProfile()
  const other = await seedProfile()
  await manageUserSession({ user_id: user, session_token: 'tok-list-1', action: 'start' })
  await manageUserSession({ user_id: other, session_token: 'tok-list-2', action: 'start' })

  const rows = await listSessions({ userId: user, loginAfter: new Date(Date.now() - 60_000) })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user_id, user)
})
