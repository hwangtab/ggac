import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/sessions.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesNotifications.test.mjs`(단계 2c)와 동일.
 *
 * 핵심 대조:
 * - `manageUserSession`이 활동 기록(로그인/로그아웃) 실패에도 세션 쓰기
 *   결과를 그대로 반환하는가(본 작업을 막지 않는가), 그리고 그 실패가
 *   `onWriteError`로 전달되는가(조용히 삼키지 않는가) — 브리프 필수
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
  await applyMigrations(setupClient)
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

test('manageUserSession(start): 프로필이 없는 사용자(FK 위반)는 던지지 않고 null을 반환하며 onWriteError로 알린다(세션 핑이 500으로 죽지 않는다 — 코드리뷰가 지적한 회귀 수정)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const errors = []
  const result = await manageUserSession(
    { user_id: 'ghost-user-nope', session_token: 'tok-ghost', action: 'start' },
    err => errors.push(err)
  )
  assert.equal(result, null, '세션 핑 API가 500 대신 조용히 null을 반환해야 한다')
  assert.equal(errors.length, 1, 'FK 위반이 onWriteError로 정확히 한 번 전달돼야 한다')
  const combined = `${errors[0]?.message ?? ''} ${errors[0]?.cause?.message ?? ''}`
  assert.match(combined, /FOREIGN KEY|FOREIGNKEY/, '전달된 오류는 실제 FK 위반이어야 한다')

  const sessionResult = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM user_sessions WHERE session_token = ?',
    args: ['tok-ghost'],
  })
  assert.equal(Number(sessionResult.rows[0].c), 0, '세션 행이 생기면 안 된다')
  const activityResult = await setupClient.execute({
    sql: "SELECT COUNT(*) AS c FROM user_activities WHERE user_id = 'ghost-user-nope'",
  })
  assert.equal(
    Number(activityResult.rows[0].c),
    0,
    '로그인 활동도 같은 FK로 막히므로 남으면 안 된다'
  )
})

test('manageUserSession(start): onWriteError 없이 프로필 없는 사용자로 호출해도 던지지 않는다(기본값은 조용한 무시)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const result = await manageUserSession({
    user_id: 'ghost-user-nope-2',
    session_token: 'tok-ghost-2',
    action: 'start',
  })
  assert.equal(result, null)
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

// ------------------------------------------- onWriteError: 부정 대조(본 작업 안 막힘)

test('manageUserSession(end): 활동 기록이 실패해도 세션 쓰기는 이미 성공했고, 실패는 onWriteError로 전달된다(삼키지 않는다)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const owner = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: owner,
    session_token: 'tok-mismatch',
    action: 'start',
  })

  // "세션 쓰기는 성공, 활동 기록만 실패"를 목(mock) 없이 실제 DB로 재현한다.
  //
  // 예전에는 남의 세션을 `user_id: 'ghost-user-nope'`로 종료시켜(토큰만으로
  // 매칭되던 시절) 활동 기록만 FK 위반으로 깨뜨렸다. 그 경로는 최종 리뷰
  // A-5에서 막혔다(교차 사용자 세션 쓰기 차단) — 이제 남의 user_id로는
  // 세션 UPDATE 자체가 0행이라 이 시나리오를 만들 수 없다.
  //
  // 대신 직렬화 불가능한 metadata(BigInt)를 넘긴다. `end`의 UPDATE는
  // `is_active`/`logout_at`만 `.set()`하므로 metadata를 건드리지 않아 그대로
  // 성공하고, `logUserActivity`는 그 metadata를 JSON 컬럼에 실으려다 던진다.
  const errors = []
  const result = await manageUserSession(
    { user_id: owner, session_token: 'tok-mismatch', action: 'end', metadata: { n: 10n } },
    err => errors.push(err)
  )

  assert.equal(result, sessionId, '세션 종료 자체는 성공해 sessionId를 반환해야 한다')
  const row = await getSessionRaw(sessionId)
  assert.equal(row.is_active, 0, '세션은 실제로 비활성화됐어야 한다(본 작업이 막히지 않았다)')

  assert.equal(errors.length, 1, '활동 기록 실패가 onWriteError로 정확히 한 번 전달돼야 한다')
  const combined = `${errors[0]?.message ?? ''} ${errors[0]?.cause?.message ?? ''}`
  assert.match(
    combined,
    /BigInt/,
    '전달된 오류는 실제로 발생한 그 오류여야 한다(조용히 다른 걸로 대체되면 안 된다)'
  )

  // 로그아웃 활동 자체는 남지 않는다(logUserActivity는
  // user_activities+daily_activity_stats를 한 배치로 묶고, 그 배치에
  // 도달하기 전에 던졌다).
  assert.equal(await countActivitiesRaw(owner, 'logout'), 0)
})

test('manageUserSession: onWriteError를 넘기지 않아도 세션 작업 자체는 여전히 성공한다(기본값은 조용한 무시)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const owner = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: owner,
    session_token: 'tok-noop-cb',
    action: 'start',
  })

  // 위 테스트와 같은 실패 주입(BigInt metadata) — 콜백을 넘기지 않았을 뿐이다.
  const result = await manageUserSession({
    user_id: owner,
    session_token: 'tok-noop-cb',
    action: 'end',
    metadata: { n: 10n },
  })
  assert.equal(result, sessionId)
})

// ------------------------------------------- 교차 사용자 세션 쓰기 차단 (최종 리뷰 A-5)
//
// 세션 토큰은 OAuth 경로에서 `session_${user.id}_${Date.now()}` 모양이고
// user id는 게시판에 공개돼 있다 — 즉 남의 토큰은 **추측 가능**하다. RLS가
// 사라진 지금 이 where절이 유일한 경계라, 아래 세 단정이 그 경계를 값으로
// 고정한다.

test('manageUserSession(update): 남의 세션 토큰으로는 metadata를 덮어쓸 수 없다(0행 매칭 → null)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const victim = await seedProfile()
  const attacker = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: victim,
    session_token: 'tok-crossuser-update',
    action: 'start',
    metadata: { page: '/mypage' },
  })

  const result = await manageUserSession({
    user_id: attacker,
    session_token: 'tok-crossuser-update',
    action: 'update',
    metadata: { page: '/hacked' },
  })

  assert.equal(result, null, '남의 세션은 매칭되지 않아야 한다')
  const row = await getSessionRaw(sessionId)
  assert.equal(row.metadata, '{"page":"/mypage"}', '피해자 metadata가 그대로 남아야 한다')
  assert.equal(row.is_active, 1)
})

test('manageUserSession(end): 남의 세션 토큰으로는 세션을 종료시킬 수 없다(활동 피드에 교차 조합 행도 남지 않는다)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const victim = await seedProfile()
  const attacker = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: victim,
    session_token: 'tok-crossuser-end',
    action: 'start',
  })

  const result = await manageUserSession({
    user_id: attacker,
    session_token: 'tok-crossuser-end',
    action: 'end',
  })

  assert.equal(result, null, '남의 세션은 매칭되지 않아야 한다')
  const row = await getSessionRaw(sessionId)
  assert.equal(row.is_active, 1, '피해자 세션이 살아 있어야 한다')
  assert.equal(row.logout_at, null)

  // 원본 RPC와 동일하게 "매칭 없음"이어도 로그아웃 활동은 기록된다. 다만
  // 그 행의 session_id는 NULL이어야 한다 — 예전에는 여기에
  // **공격자 user_id + 피해자 session_id** 조합이 남았다.
  const logoutRows = await setupClient.execute({
    sql: 'SELECT session_id FROM user_activities WHERE user_id = ? AND action_type = ?',
    args: [attacker, 'logout'],
  })
  assert.equal(logoutRows.rows.length, 1)
  assert.equal(
    logoutRows.rows[0].session_id,
    null,
    '피해자 session_id가 공격자 활동 행에 실리면 안 된다'
  )
})

test('부정 대조: 같은 사용자 자신의 세션은 update/end 모두 그대로 동작한다(경계가 정상 경로를 막지 않는다)', async () => {
  const { manageUserSession } = await loadFreshSessionsModule()
  const owner = await seedProfile()
  const sessionId = await manageUserSession({
    user_id: owner,
    session_token: 'tok-self-roundtrip',
    action: 'start',
  })

  const updated = await manageUserSession({
    user_id: owner,
    session_token: 'tok-self-roundtrip',
    action: 'update',
    metadata: { page: '/board' },
  })
  assert.equal(updated, sessionId)
  assert.equal((await getSessionRaw(sessionId)).metadata, '{"page":"/board"}')

  const ended = await manageUserSession({
    user_id: owner,
    session_token: 'tok-self-roundtrip',
    action: 'end',
  })
  assert.equal(ended, sessionId)
  assert.equal((await getSessionRaw(sessionId)).is_active, 0)
})

// ------------------------------------------------------------- listActiveUsers

test('listActiveUsers: 정상 경로(프로필 있는 신규 회원)의 세션은 즉시 나타난다', async () => {
  // 이 테스트는 원본 INNER JOIN 버그(세션은 있는데 프로필이 없는 시점)를
  // 재현하지 않는다 — Turso 스키마의 FK가 그 시점 자체를 막기 때문에
  // 재현할 수 없다(모듈 설명 정정 참고). 여기서는 정상 경로가 절대
  // 빠지지 않는다는 것만 확인한다. 원본 버그와 정확히 같은 실패 모드
  // (세션은 있는데 프로필이 없다)가 여전히 재현 가능한지는 아래
  // "manageUserSession(start): 프로필이 없는 사용자" 테스트가 별도로
  // 확인한다(결론: 세션 자체가 안 생긴다 — 회원이 안 보이는 결과는
  // 원본과 같다, 5xx만 막았다).
  const { manageUserSession, listActiveUsers } = await loadFreshSessionsModule()
  const freshMember = await seedProfile({ display_name: '방금가입한신입' })

  await manageUserSession({ user_id: freshMember, session_token: 'tok-fresh', action: 'start' })

  const activeUsers = await listActiveUsers(50)
  const found = activeUsers.find(u => u.user_id === freshMember)
  assert.ok(found, '신규 회원의 세션이 실시간 접속자 목록에서 사라지면 안 된다')
  assert.equal(found.display_name, '방금가입한신입')
  assert.equal(found.session_token, 'tok-fresh')
})

test('listActiveUsers: user_id가 NULL인 이관 고아 세션(--null-orphan-fk)도 LEFT JOIN 폴백으로 나타난다 — 원본 INNER JOIN이라면 걸러졌을 행이다', async () => {
  // Turso에서 유일하게 재현 가능한 "세션은 있는데 프로필은 없는" 경로 —
  // FK 위반(정상 쓰기 경로)이 아니라, 이관 스크립트(stage4.mjs)의
  // --null-orphan-fk 옵션이 고아 참조를 NULL로 이관했을 때다. session_token
  // UNIQUE 제약을 만족하기만 하면 되므로 원시 INSERT로 직접 재현한다.
  const { listActiveUsers } = await loadFreshSessionsModule()
  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO user_sessions (id, user_id, session_token, last_activity, is_active, login_at, metadata)
          VALUES ('orphan-session-1', NULL, 'tok-orphan', ?, 1, ?, '{}')`,
    args: [now, now],
  })

  const activeUsers = await listActiveUsers(50)
  const found = activeUsers.find(u => u.session_token === 'tok-orphan')
  assert.ok(
    found,
    'user_id가 NULL인 세션도 LEFT JOIN 폴백으로 나타나야 한다 — INNER JOIN이었다면 이 행은 걸러졌을 것이다'
  )
  assert.equal(found.display_name, '(프로필 없음)', '표시명은 COALESCE 폴백 문자열이어야 한다')
  assert.equal(found.email, '', '이메일은 빈 문자열 폴백이어야 한다')
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
