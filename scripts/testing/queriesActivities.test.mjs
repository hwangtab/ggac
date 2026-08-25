import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/activities.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesNotifications.test.mjs`(단계 2c)와 동일.
 *
 * 핵심 대조:
 * - `logUserActivity`/`logUserActivitiesBatch`가 실패하면 조용히 삼키지
 *   않고 던지는가(부정 대조 — 호출부가 이 예외를 잡아 로그를 남기고 본
 *   작업을 막지 않을 책임을 진다. sessions.ts는 그 계약을 실제로 쓴다).
 * - `logUserActivitiesBatch`가 로그 건수만큼 도는 루프로 되돌아가면
 *   소스 가드가 잡는가.
 * - `get_user_activity_stats`/`weekly_activity_stats`류의 집계가 실제로
 *   틀리면(오라클은 raw COUNT/원시 쿼리) 이 스위트가 잡는가.
 */

const DB_PATH = 'scripts/testing/.queries-activities-test.db'
const ACTIVITIES_MODULE_URL = new URL('../../src/db/queries/activities.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshActivitiesModule() {
  return import(`${ACTIVITIES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
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

test('부정 대조 기반: logUserActivity가 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { logUserActivity } = await loadFreshActivitiesModule()
    await assert.rejects(() => logUserActivity({ user_id: 'any-user', action_type: 'login' }))
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
async function seedProfile(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `activity-profile-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: overrides.display_name ?? '활동테스트회원',
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

async function countUserActivitiesRaw(userId) {
  const result = await setupClient.execute({
    sql: 'SELECT COUNT(*) AS c FROM user_activities WHERE user_id = ?',
    args: [userId],
  })
  return Number(result.rows[0].c)
}

async function getDailyStatRaw(userId, actionType, activityDate) {
  const result = await setupClient.execute({
    sql: 'SELECT count FROM daily_activity_stats WHERE user_id = ? AND action_type = ? AND activity_date = ?',
    args: [userId, actionType, activityDate],
  })
  return result.rows[0] ? Number(result.rows[0].count) : null
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// ------------------------------------------------------------- logUserActivity

test('logUserActivity: user_activities에 INSERT하고 daily_activity_stats를 1로 생성한다', async () => {
  const { logUserActivity } = await loadFreshActivitiesModule()
  const user = await seedProfile()

  const id = await logUserActivity({
    user_id: user,
    action_type: 'like_added',
    target_type: 'post',
    target_id: 'post-1',
    metadata: { post_title: '글' },
    ip_address: '127.0.0.1',
    user_agent: 'test-agent',
  })

  assert.ok(id)
  assert.equal(await countUserActivitiesRaw(user), 1)
  assert.equal(await getDailyStatRaw(user, 'like_added', todayStr()), 1)
})

test('logUserActivity: 같은 사용자·같은 액션타입을 같은 날 두 번 기록하면 daily_activity_stats가 2로 증가한다(덮어쓰지 않는다)', async () => {
  const { logUserActivity } = await loadFreshActivitiesModule()
  const user = await seedProfile()

  await logUserActivity({ user_id: user, action_type: 'page_viewed' })
  await logUserActivity({ user_id: user, action_type: 'page_viewed' })

  assert.equal(await countUserActivitiesRaw(user), 2, 'user_activities에는 두 행이 쌓여야 한다')
  assert.equal(
    await getDailyStatRaw(user, 'page_viewed', todayStr()),
    2,
    '카운트는 증가해야지 덮어써지면 안 된다'
  )
})

test('logUserActivity: 존재하지 않는 user_id는 FK 위반으로 거부되고 아무것도 남지 않는다(트랜잭션 원자성)', async () => {
  const { logUserActivity } = await loadFreshActivitiesModule()
  await assert.rejects(
    () => logUserActivity({ user_id: 'ghost-user-nope', action_type: 'login' }),
    err => /FOREIGN KEY|FOREIGNKEY/.test(`${err?.message ?? ''} ${err?.cause?.message ?? ''}`)
  )
  assert.equal(await countUserActivitiesRaw('ghost-user-nope'), 0)
})

// ------------------------------------------------------------- logUserActivitiesBatch

test('logUserActivitiesBatch: 여러 로그를 한 번에 삽입하고 daily_activity_stats를 액션타입별로 묶어 upsert한다', async () => {
  const { logUserActivitiesBatch } = await loadFreshActivitiesModule()
  const user = await seedProfile()

  const inserted = await logUserActivitiesBatch(user, [
    { action_type: 'page_viewed' },
    { action_type: 'page_viewed' },
    { action_type: 'page_viewed' },
    { action_type: 'search_performed' },
    { action_type: 'search_performed' },
  ])

  assert.equal(inserted, 5)
  assert.equal(await countUserActivitiesRaw(user), 5)
  assert.equal(await getDailyStatRaw(user, 'page_viewed', todayStr()), 3)
  assert.equal(await getDailyStatRaw(user, 'search_performed', todayStr()), 2)
})

test('logUserActivitiesBatch: 기존 daily_activity_stats가 있으면 그룹 카운트만큼 더한다(덮어쓰지 않는다)', async () => {
  const { logUserActivity, logUserActivitiesBatch } = await loadFreshActivitiesModule()
  const user = await seedProfile()

  await logUserActivity({ user_id: user, action_type: 'like_added' })
  await logUserActivitiesBatch(user, [{ action_type: 'like_added' }, { action_type: 'like_added' }])

  assert.equal(await getDailyStatRaw(user, 'like_added', todayStr()), 3, '1(단건) + 2(배치) = 3')
})

test('logUserActivitiesBatch: 빈 배열이면 쿼리 없이 0을 반환한다', async () => {
  const { logUserActivitiesBatch } = await loadFreshActivitiesModule()
  const count = await logUserActivitiesBatch('any-user', [])
  assert.equal(count, 0)
})

test('logUserActivitiesBatch: 존재하지 않는 user_id가 섞이면 전체가 FK 위반으로 거부된다(부분 삽입 없음)', async () => {
  const { logUserActivitiesBatch } = await loadFreshActivitiesModule()
  await assert.rejects(() =>
    logUserActivitiesBatch('ghost-user-nope', [{ action_type: 'login' }, { action_type: 'logout' }])
  )
  assert.equal(await countUserActivitiesRaw('ghost-user-nope'), 0)
})

// 소스 가드 — logUserActivitiesBatch가 로그 건수만큼 도는 루프(로그당 INSERT)로
// 되돌아가면 잡는다. action_type별로 묶은 결과(최대 ACTIVITY_ACTION_TYPE.length
// 그룹, logs.length가 아니다)를 훑는 순수 JS 집계 루프는 N+1이 아니므로 허용한다
// — 그 루프 안에 DB 호출(`insert(`/`tx.`)이 없는지만 확인한다.
test('logUserActivitiesBatch 구현은 user_activities에 배치 INSERT 한 번이다 — logs를 도는 루프로 삽입하면 안 된다 (소스 가드)', () => {
  const src = readFileSync('src/db/queries/activities.ts', 'utf8')
  const match = src.match(/export async function logUserActivitiesBatch\([\s\S]*?\n\}\n/)
  assert.ok(match, 'logUserActivitiesBatch 함수 본문을 찾지 못했다')
  const body = match[0]

  const insertIntoActivities = body.match(/tx\s*\.\s*insert\(userActivities\)/g) ?? []
  assert.equal(
    insertIntoActivities.length,
    1,
    'user_activities로의 insert(...) 호출은 정확히 한 번이어야 한다(배치)'
  )

  assert.match(
    body,
    /\.values\(\s*\n?\s*logs\.map\(/,
    'user_activities의 values()에는 logs.map(...)으로 만든 행 배열을 통째로 넘겨야 한다'
  )

  // 루프(for/while/forEach)가 있다면, 그 루프 블록 안에서 DB 호출(insert(/tx.)이
  // 일어나면 안 된다 — 있다면 로그당 왕복(N+1)으로 되돌아간 것이다.
  const loopMatches =
    body.match(/for\s*\([^)]*\)\s*\{[^{}]*\}|while\s*\([^)]*\)\s*\{[^{}]*\}/g) ?? []
  for (const loopBlock of loopMatches) {
    assert.doesNotMatch(
      loopBlock,
      /\.insert\(|tx\s*\./,
      `logUserActivitiesBatch의 루프 안에서 DB 호출이 발견됐다(N+1 회귀): ${loopBlock}`
    )
  }
})

// ------------------------------------------------------------- listActivities

test('listActivities: 날짜/사용자 필터가 적용된다', async () => {
  const { logUserActivity, listActivities } = await loadFreshActivitiesModule()
  const user = await seedProfile()
  const other = await seedProfile()
  await logUserActivity({ user_id: user, action_type: 'post_created' })
  await logUserActivity({ user_id: other, action_type: 'post_created' })

  const rows = await listActivities({ userId: user, startDate: new Date(Date.now() - 60_000) })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user_id, user)
})

test('listActivities: excludeGeneratedMetadata가 metadata.generated===true인 행을 제외한다', async () => {
  const { logUserActivity, listActivities } = await loadFreshActivitiesModule()
  const user = await seedProfile()
  await logUserActivity({
    user_id: user,
    action_type: 'search_performed',
    metadata: { generated: true },
  })
  await logUserActivity({
    user_id: user,
    action_type: 'search_performed',
    metadata: { generated: false },
  })
  await logUserActivity({ user_id: user, action_type: 'search_performed' })

  const all = await listActivities({ userId: user, startDate: new Date(Date.now() - 60_000) })
  assert.equal(all.length, 3)

  const filtered = await listActivities({
    userId: user,
    startDate: new Date(Date.now() - 60_000),
    excludeGeneratedMetadata: true,
  })
  assert.equal(filtered.length, 2, 'generated:true인 한 행만 제외돼야 한다')
})

test('listActivities: actionTypes 필터가 적용된다', async () => {
  const { logUserActivity, listActivities } = await loadFreshActivitiesModule()
  const user = await seedProfile()
  await logUserActivity({ user_id: user, action_type: 'post_created' })
  await logUserActivity({ user_id: user, action_type: 'comment_created' })
  await logUserActivity({ user_id: user, action_type: 'like_added' })

  const rows = await listActivities({
    userId: user,
    startDate: new Date(Date.now() - 60_000),
    actionTypes: ['post_created', 'comment_created'],
  })
  assert.equal(rows.length, 2)
  assert.ok(rows.every(r => ['post_created', 'comment_created'].includes(r.action_type)))
})

test('listActivities: endDate는 원본 admin/reports/generate의 .lte와 동일하게 그 시각을 포함한다(배타적 lt가 아니다)', async () => {
  const { logUserActivity, listActivities } = await loadFreshActivitiesModule()
  const user = await seedProfile()
  const id = await logUserActivity({ user_id: user, action_type: 'post_updated' })

  const raw = await setupClient.execute({
    sql: 'SELECT created_at FROM user_activities WHERE id = ?',
    args: [id],
  })
  const createdAt = new Date(Number(raw.rows[0].created_at))

  const rows = await listActivities({
    userId: user,
    startDate: new Date(createdAt.getTime() - 60_000),
    endDate: createdAt,
  })
  assert.ok(
    rows.some(r => r.id === id),
    'endDate와 정확히 같은 시각의 활동은 포함돼야 한다(lte, 원본과 동일)'
  )
})

// ------------------------------------------------------------- listActivitiesWithProfile

test('listActivitiesWithProfile: member_profiles를 임베드하고 total을 별도 COUNT로 반환한다', async () => {
  const { logUserActivity, listActivitiesWithProfile } = await loadFreshActivitiesModule()
  const user = await seedProfile({ display_name: '조인테스트' })
  await logUserActivity({ user_id: user, action_type: 'login' })
  await logUserActivity({ user_id: user, action_type: 'logout' })

  const { rows, total } = await listActivitiesWithProfile({
    userId: user,
    startDate: new Date(Date.now() - 60_000),
    page: 1,
    limit: 20,
  })

  assert.equal(total, 2)
  assert.equal(rows.length, 2)
  assert.ok(rows[0].member_profiles)
  assert.equal(rows[0].member_profiles.display_name, '조인테스트')
  assert.ok(rows[0].created_at >= rows[1].created_at, 'created_at 내림차순이어야 한다')
})

test('listActivitiesWithProfile: user_id가 NULL인 행(탈퇴 회원)은 member_profiles가 null이다', async () => {
  const { listActivitiesWithProfile } = await loadFreshActivitiesModule()
  // ON DELETE SET NULL을 직접 재현: user_id가 NULL인 행을 원시로 삽입한다.
  await setupClient.execute({
    sql: `INSERT INTO user_activities (id, user_id, action_type, metadata, created_at)
          VALUES ('orphan-activity-1', NULL, 'login', '{}', ?)`,
    args: [Date.now()],
  })

  const { rows } = await listActivitiesWithProfile({
    startDate: new Date(Date.now() - 60_000),
    page: 1,
    limit: 20,
  })
  const orphan = rows.find(r => r.id === 'orphan-activity-1')
  assert.ok(orphan)
  assert.equal(orphan.member_profiles, null)
})

test('listActivitiesWithProfile: action_type/target_type 필터와 페이지네이션이 적용된다', async () => {
  const { logUserActivity, listActivitiesWithProfile } = await loadFreshActivitiesModule()
  const user = await seedProfile()
  for (let i = 0; i < 3; i++) {
    await logUserActivity({
      user_id: user,
      action_type: 'like_added',
      target_type: 'post',
      target_id: `p${i}`,
    })
  }
  await logUserActivity({
    user_id: user,
    action_type: 'comment_created',
    target_type: 'comment',
    target_id: 'c1',
  })

  const { rows, total } = await listActivitiesWithProfile({
    userId: user,
    actionType: 'like_added',
    startDate: new Date(Date.now() - 60_000),
    page: 1,
    limit: 2,
  })
  assert.equal(total, 3, 'total은 페이지 크기와 무관하게 필터에 맞는 전체 수여야 한다')
  assert.equal(rows.length, 2, '이 페이지는 limit만큼만 담아야 한다')
  assert.ok(rows.every(r => r.action_type === 'like_added'))
})

// ------------------------------------------------------------- getUserActivityStats

test('getUserActivityStats: 집계(total_count/unique_days/avg_per_day)가 raw COUNT와 일치한다', async () => {
  const { logUserActivity, getUserActivityStats } = await loadFreshActivitiesModule()
  const user = await seedProfile()

  await logUserActivity({ user_id: user, action_type: 'post_created' })
  await logUserActivity({ user_id: user, action_type: 'post_created' })
  await logUserActivity({ user_id: user, action_type: 'comment_created' })

  const stats = await getUserActivityStats({
    userId: user,
    startDate: new Date(Date.now() - 86_400_000),
    endDate: new Date(),
  })

  const postStat = stats.find(s => s.action_type === 'post_created')
  const commentStat = stats.find(s => s.action_type === 'comment_created')
  assert.equal(postStat.total_count, 2)
  assert.equal(postStat.unique_days, 1)
  assert.equal(postStat.avg_per_day, 2)
  assert.equal(commentStat.total_count, 1)
  assert.ok(postStat.first_activity)
  assert.ok(postStat.last_activity)
})

test('getUserActivityStats: p_user_id에 해당하는 null(userId 미지정)이면 전체 사용자를 집계한다', async () => {
  const { logUserActivity, getUserActivityStats } = await loadFreshActivitiesModule()
  const u1 = await seedProfile()
  const u2 = await seedProfile()
  await logUserActivity({ user_id: u1, action_type: 'file_uploaded' })
  await logUserActivity({ user_id: u2, action_type: 'file_uploaded' })

  const stats = await getUserActivityStats({
    startDate: new Date(Date.now() - 86_400_000),
    endDate: new Date(),
  })
  const stat = stats.find(s => s.action_type === 'file_uploaded')
  assert.ok(stat.total_count >= 2, '두 사용자 모두 집계에 포함돼야 한다')
})

// ------------------------------------------------------------- getRealTimeActivityFeed

test('getRealTimeActivityFeed: 최근 24시간 내 활동만, user_name을 채워 반환한다', async () => {
  const { logUserActivity, getRealTimeActivityFeed } = await loadFreshActivitiesModule()
  const user = await seedProfile({ display_name: '피드테스트' })
  await logUserActivity({ user_id: user, action_type: 'post_created' })

  // 25시간 전 활동을 원시로 삽입 — 창 밖이라 제외돼야 한다.
  await setupClient.execute({
    sql: `INSERT INTO user_activities (id, user_id, action_type, metadata, created_at)
          VALUES ('old-activity-1', ?, 'post_created', '{}', ?)`,
    args: [user, Date.now() - 25 * 60 * 60 * 1000],
  })

  const feed = await getRealTimeActivityFeed({ limit: 50 })
  assert.ok(feed.some(f => f.user_name === '피드테스트'))
  assert.ok(!feed.some(f => f.id === 'old-activity-1'), '24시간 밖의 활동은 제외돼야 한다')
  assert.match(feed[0].time_ago_text, /전$/)
})

test('getRealTimeActivityFeed: actionTypes 필터가 적용된다', async () => {
  const { logUserActivity, getRealTimeActivityFeed } = await loadFreshActivitiesModule()
  const user = await seedProfile()
  await logUserActivity({ user_id: user, action_type: 'login' })
  await logUserActivity({ user_id: user, action_type: 'logout' })

  const feed = await getRealTimeActivityFeed({ limit: 50, actionTypes: ['login'] })
  assert.ok(feed.every(f => f.action_type === 'login'))
  assert.ok(feed.some(f => f.user_id === user))
})

test('getRealTimeActivityFeed: user_id가 NULL인 행(탈퇴 회원)은 INNER JOIN이 걸러낸다', async () => {
  const { getRealTimeActivityFeed } = await loadFreshActivitiesModule()
  await setupClient.execute({
    sql: `INSERT INTO user_activities (id, user_id, action_type, metadata, created_at)
          VALUES ('orphan-feed-1', NULL, 'login', '{}', ?)`,
    args: [Date.now()],
  })
  const feed = await getRealTimeActivityFeed({ limit: 100 })
  assert.ok(!feed.some(f => f.id === 'orphan-feed-1'))
})

// ------------------------------------------------------------- getWeeklyActivityStats

test('getWeeklyActivityStats: total_count/unique_users가 raw COUNT/COUNT(DISTINCT)와 일치한다', async () => {
  const { logUserActivity, getWeeklyActivityStats } = await loadFreshActivitiesModule()
  const u1 = await seedProfile()
  const u2 = await seedProfile()
  await logUserActivity({ user_id: u1, action_type: 'post_created' })
  await logUserActivity({ user_id: u1, action_type: 'post_created' })
  await logUserActivity({ user_id: u2, action_type: 'post_created' })

  const stats = await getWeeklyActivityStats()
  const thisWeek = stats.filter(s => s.action_type === 'post_created')
  const totalCount = thisWeek.reduce((sum, s) => sum + s.total_count, 0)
  assert.ok(totalCount >= 3)
  const uniqueUsers = new Set()
  const raw = await setupClient.execute({
    sql: "SELECT DISTINCT user_id FROM user_activities WHERE action_type = 'post_created'",
  })
  raw.rows.forEach(r => uniqueUsers.add(r.user_id))
  const reportedUnique = thisWeek.reduce((max, s) => Math.max(max, s.unique_users), 0)
  assert.equal(reportedUnique, uniqueUsers.size)
})

test('getWeeklyActivityStats: 8주보다 오래된 활동은 창 밖이라 집계에서 빠진다', async () => {
  const { getWeeklyActivityStats } = await loadFreshActivitiesModule()
  const user = await seedProfile()
  await setupClient.execute({
    sql: `INSERT INTO user_activities (id, user_id, action_type, metadata, created_at)
          VALUES ('ancient-activity-1', ?, 'member_approved', '{}', ?)`,
    args: [user, Date.now() - 9 * 7 * 24 * 60 * 60 * 1000],
  })
  const stats = await getWeeklyActivityStats()
  assert.ok(!stats.some(s => s.action_type === 'member_approved'), '9주 전 활동은 8주 창 밖이다')
})

// ------------------------------------------------------------- listDailyActivityStats

test('listDailyActivityStats: activity_date 범위(포함)로 필터하고 오름차순으로 반환한다', async () => {
  const { logUserActivity, listDailyActivityStats } = await loadFreshActivitiesModule()
  const user = await seedProfile()
  await logUserActivity({ user_id: user, action_type: 'admin_action' })

  const today = todayStr()
  const rows = await listDailyActivityStats(new Date(today), new Date(today))
  assert.ok(rows.some(r => r.activity_date === today && r.action_type === 'admin_action'))

  const yesterday = new Date(Date.now() - 86_400_000)
  const beforeToday = await listDailyActivityStats(yesterday, new Date(yesterday.getTime() + 1))
  assert.ok(!beforeToday.some(r => r.action_type === 'admin_action'))
})
