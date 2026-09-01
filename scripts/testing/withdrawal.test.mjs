import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

const CONSTANTS = new URL('../../src/constants/memberProfile.ts', import.meta.url)

/**
 * `src/db/queries/withdrawal.ts`가 쓰는 `src/db/client.ts`의 `db`는 모듈
 * 수준 지연 Proxy라, 처음 실제로 접근하는 시점의 `TURSO_DATABASE_URL`로 연결을
 * 고정해 프로세스 안에서 재사용한다(`cachedRawClient`). 그래서 이 env를 **그
 * 모듈을 처음 import하기 전에** 파일 스코프에서 직접 설정해야 한다 — 실행자가
 * 셸에서 손으로 넘겨주는 값에만 기대면(운영 자격증명이 셸에 남은 채
 * `npm run test:unit`을 돌리는 경우) 이 테스트가 실제로 운영 DB에 UPDATE를
 * 쏠 수 있다. `scripts/testing/queriesProfiles.test.mjs`를 비롯한
 * `queries*.test.mjs` 전부가 이 패턴을 쓴다 — 새 방식을 발명하지 않는다.
 */
const DB_PATH = 'scripts/testing/.withdrawal-test.db'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

const WITHDRAWAL_MODULE_URL = new URL('../../src/db/queries/withdrawal.ts', import.meta.url)

/** 승인·활성 조합원 한 명을 심는다. */
async function seedMember(client, { id = 'm1', isAdmin = false } = {}) {
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO member_profiles
            (id, email, display_name, registration_status, is_active, is_admin, created_at, updated_at)
          VALUES (?, ?, ?, 'approved', 1, ?, ?, ?)`,
    args: [id, `${id}@example.test`, `회원 ${id}`, isAdmin ? 1 : 0, now, now],
  })
  return id
}

async function statusOf(client, id) {
  const result = await client.execute({
    sql: 'SELECT registration_status s FROM member_profiles WHERE id=?',
    args: [id],
  })
  return result.rows[0]?.s
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

test('탈퇴 상태 두 개가 상태 목록에 있다', async () => {
  const { REGISTRATION_STATUSES } = await import(CONSTANTS.href)
  assert.ok(REGISTRATION_STATUSES.includes('withdrawal_requested'))
  assert.ok(REGISTRATION_STATUSES.includes('withdrawn'))
  // 기존 값이 사라지면 승인·거부 흐름이 통째로 깨진다.
  for (const existing of ['pending', 'approved', 'rejected']) {
    assert.ok(REGISTRATION_STATUSES.includes(existing), `${existing}가 사라졌다`)
  }
})

test('자리표시자 이메일은 회원마다 다르고 실제 도메인이 아니다', async () => {
  const { withdrawnEmailFor } = await import(CONSTANTS.href)
  assert.equal(withdrawnEmailFor('abc'), 'withdrawn+abc@ggac.invalid')
  assert.notEqual(withdrawnEmailFor('a'), withdrawnEmailFor('b'))
  // `member_profiles_email_idx`가 UNIQUE라 두 탈퇴자가 충돌하면 안 된다.
  // `.invalid`는 RFC 2606이 예약한 도메인이라 실제로 메일이 가지 않는다.
  assert.match(withdrawnEmailFor('x'), /@ggac\.invalid$/)
})

test('탐지기의 상태 목록이 앱 상수와 정확히 같다(양방향)', async () => {
  // 문자열 slice로 "어디서부터 어디까지"를 정하면 이 뒤에 새 불변식이 늘 때마다
  // 경계가 조용히 넓어진다(리뷰 지적: 이벤트 신청용 notIn('status', [...])이
  // 뒤에 있어서 registration_status 블록에서 'pending'을 지워도 이 검사가
  // 여전히 통과했다). 그래서 텍스트를 훑는 대신 `CHECK_INVARIANTS` 배열에서
  // 해당 항목의 `where` 절을 직접 파싱해 배열 대 배열로 비교한다 —
  // `missingCheckConstraints.test.mjs`가 이미 이 모듈을 임포트해 쓰는
  // 선례를 따른다.
  const { REGISTRATION_STATUSES } = await import(CONSTANTS.href)
  const { CHECK_INVARIANTS } = await import(
    new URL('../../scripts/turso/check-invariants.mjs', import.meta.url).href
  )

  const invariant = CHECK_INVARIANTS.find(
    i => i.constraint === 'member_profiles_registration_status_check'
  )
  assert.ok(invariant, 'CHECK_INVARIANTS에서 member_profiles_registration_status_check를 못 찾았다')

  const match = invariant.where.match(/NOT IN \(([^)]*)\)/)
  assert.ok(match, `탐지기 where 절 형식이 바뀌었다: ${invariant.where}`)
  const detectorStatuses = match[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''))

  // 양방향: 앱에만 있는 값(탐지기 누락 = 정상 데이터를 위반으로 오탐)과
  // 탐지기에만 있는 값(앱에 없는 잉여 = 반대로 실제 위반을 놓침) 둘 다 잡는다.
  assert.deepEqual(
    [...detectorStatuses].sort(),
    [...REGISTRATION_STATUSES].sort(),
    '탐지기 상태 목록과 앱 상수(REGISTRATION_STATUSES)가 어긋난다'
  )
})

test('신청·취소가 조건부 UPDATE로 승인↔신청 상태를 오가고, 다른 조합원은 건드리지 않는다', async () => {
  // m1만 신청·취소를 거치고, m2는 승인 상태 그대로 남아야 한다 — id 술어가
  // 빠지면(리뷰 지적) 승인 상태 조합원 전원이 함께 바뀌는데, 조합원이 한 명뿐인
  // 픽스처로는 그 결함이 드러나지 않는다.
  await seedMember(setupClient, { id: 'm1' })
  await seedMember(setupClient, { id: 'm2' })

  const { requestWithdrawal, cancelWithdrawal } = await import(WITHDRAWAL_MODULE_URL.href)

  assert.equal(await requestWithdrawal('m1'), true)
  assert.equal(await statusOf(setupClient, 'm1'), 'withdrawal_requested')
  assert.equal(await statusOf(setupClient, 'm2'), 'approved')

  // 두 번째 신청은 이미 신청 상태라 false — 조건부 UPDATE의 rowsAffected 판정.
  assert.equal(await requestWithdrawal('m1'), false)

  assert.equal(await cancelWithdrawal('m1'), true)
  assert.equal(await statusOf(setupClient, 'm1'), 'approved')
  assert.equal(await statusOf(setupClient, 'm2'), 'approved')

  // 승인 상태에서 또 취소하면 false
  assert.equal(await cancelWithdrawal('m1'), false)
})

/**
 * 확정(`withdrawMember`)용 픽스처.
 *
 * 앞의 신청·취소 테스트가 남긴 행 위에 얹으면 "지워졌는가"를 세는 단언이
 * 남의 행을 세게 된다. 그래서 매번 관련 표를 전부 비우고 처음부터 심는다.
 * 지우는 순서는 FK 자식 → 부모다(`PRAGMA foreign_keys`가 켜져 있다 — 실측).
 */
const WITHDRAWAL_FIXTURE_TABLES = [
  'post_likes',
  'comments',
  'posts',
  'board_meeting_attendees',
  'board_minutes',
  'board_documents',
  'board_meetings',
  'user_settings',
  'daily_activity_stats',
  'user_sessions',
  'user_activities',
  'notifications',
  'billing_keys',
  'membership_dues',
  'payments',
  'account',
  'session',
  'user',
  'member_profiles',
]

/**
 * m1(탈퇴 대상)과 m2(관리자)를 심고, m1에게 네 갈래를 전부 붙인다 —
 * ① 신원·로그인 수단, ② 콘텐츠(글·댓글), ③ 로그, ④ 돈.
 */
async function seedWithdrawalFixture(
  client,
  { targetStatus = 'withdrawal_requested', adminStatus = 'approved' } = {}
) {
  for (const table of WITHDRAWAL_FIXTURE_TABLES) await client.execute(`DELETE FROM "${table}"`)
  const now = Date.now()

  // ① 신원 — 지워져야 할 값을 전부 채워 둔다. 비어 있으면 "지웠다"가 증명되지 않는다.
  // artist_role은 일부러 기본값('owner')이 아닌 값으로 둔다 — 되돌려지는지 봐야 한다.
  await client.execute({
    sql: `INSERT INTO member_profiles
            (id, email, display_name, real_name, phone_number, birth_date,
             bank_name, account_number, account_holder, monthly_fee,
             registration_status, is_active, is_admin, is_member, is_artist,
             is_director, is_auditor, is_suspended, suspension_reason, suspension_until,
             artist_role, artist_id, director_title, last_login_at, created_at, updated_at)
          VALUES ('m1', 'm1@example.test', '회원 m1', '홍길동', '010-1234-5678', '1990-01-01',
                  '국민은행', '110-1234-567890', '홍길동', 30000,
                  ?, 1, 0, 1, 1,
                  1, 1, 1, '경고 누적', ?,
                  'member', 'artist-014', '사무국장', ?, ?, ?)`,
    args: [targetStatus, now, now, now, now],
  })
  await client.execute({
    sql: `INSERT INTO member_profiles
            (id, email, display_name, real_name, registration_status, is_active, is_admin,
             created_at, updated_at)
          VALUES ('m2', 'm2@example.test', '회원 m2', '김관리', ?, 1, 1, ?, ?)`,
    args: [adminStatus, now, now],
  })

  for (const id of ['m1', 'm2']) {
    await client.execute({
      sql: `INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at)
            VALUES (?, ?, ?, 1, 'https://example.test/face.png', ?, ?)`,
      args: [id, `회원 ${id}`, `${id}@example.test`, now, now],
    })
  }
  await client.execute({
    sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
          VALUES ('s1', ?, 'tok-1', ?, ?, 'm1')`,
    args: [now + 60_000, now, now],
  })
  await client.execute({
    sql: `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
          VALUES ('a1', 'm1', 'credential', 'm1', 'hashed', ?, ?)`,
    args: [now, now],
  })

  // ② 콘텐츠·조합 기록 — 한 건도 바뀌면 안 되는 것들. 스펙이 나열한 7종
  // (글·댓글·이사회 회의록·서류·회의·출석·좋아요) 전부를 심는다 — 일부만
  // 심으면 나머지 종류에 대한 회귀를 잡을 테스트가 없어진다.
  await client.execute({
    sql: `INSERT INTO posts (id, title, content, category, author_id, created_at, updated_at)
          VALUES ('p1', '조합 소식', '본문입니다', '잡담', 'm1', ?, ?)`,
    args: [now, now],
  })
  await client.execute({
    sql: `INSERT INTO comments (id, post_id, author_id, content, created_at, updated_at)
          VALUES ('c1', 'p1', 'm1', '댓글입니다', ?, ?)`,
    args: [now, now],
  })
  await client.execute({
    sql: `INSERT INTO post_likes (id, post_id, user_id, created_at)
          VALUES ('pl1', 'p1', 'm1', ?)`,
    args: [now],
  })
  await client.execute({
    sql: `INSERT INTO board_meetings
            (id, title, meeting_date, meeting_time, location, status, created_by, created_at, updated_at)
          VALUES ('bm1', '9월 정기회의', '2026-09-10', '19:00', '사무국', 'scheduled', 'm1', ?, ?)`,
    args: [now, now],
  })
  await client.execute({
    sql: `INSERT INTO board_minutes (id, meeting_id, content, content_format, author_id, created_at, updated_at)
          VALUES ('bmin1', 'bm1', '회의록 본문입니다', 'plain', 'm1', ?, ?)`,
    args: [now, now],
  })
  await client.execute({
    sql: `INSERT INTO board_documents
            (id, title, category, file_path, file_name, file_size, mime_type, uploaded_by, created_at)
          VALUES ('bdoc1', '정관', '정관', 'board/articles.pdf', 'articles.pdf', 1024, 'application/pdf', 'm1', ?)`,
    args: [now],
  })
  await client.execute({
    sql: `INSERT INTO board_meeting_attendees (id, meeting_id, member_id, attended, created_at, updated_at)
          VALUES ('batt1', 'bm1', 'm1', 1, ?, ?)`,
    args: [now, now],
  })

  // ③ 로그 — IP·User-Agent가 들어 있다. 전부 사라져야 한다.
  for (const [id, action] of [
    ['ua1', 'login'],
    ['ua2', 'page_viewed'],
  ]) {
    await client.execute({
      sql: `INSERT INTO user_activities (id, user_id, action_type, ip_address, user_agent, created_at)
            VALUES (?, 'm1', ?, '203.0.113.7', 'Mozilla/5.0', ?)`,
      args: [id, action, now],
    })
  }
  await client.execute({
    sql: `INSERT INTO user_sessions (id, user_id, session_token, last_activity, login_at)
          VALUES ('us1', 'm1', 'st-1', ?, ?)`,
    args: [now, now],
  })
  await client.execute({
    sql: `INSERT INTO daily_activity_stats (id, activity_date, user_id, action_type, count, last_updated)
          VALUES ('da1', '2026-09-01', 'm1', 'login', 3, ?)`,
    args: [now],
  })
  await client.execute({
    sql: `INSERT INTO notifications (id, user_id, type, title, message, created_at)
          VALUES ('n1', 'm1', 'welcome', '환영합니다', '가입을 환영합니다', ?)`,
    args: [now],
  })
  // 남의 알림이 m1을 가리킨다 — 알림 자체는 m2 것이라 남고, 참조만 끊겨야 한다.
  await client.execute({
    sql: `INSERT INTO notifications (id, user_id, type, title, message, related_user_id, created_at)
          VALUES ('n2', 'm2', 'post_reply', '새 답글', 'm1이 답글을 달았습니다', 'm1', ?)`,
    args: [now],
  })
  await client.execute({
    sql: `INSERT INTO user_settings (id, user_id, category, setting_key, created_at, updated_at)
          VALUES ('st1', 'm1', 'notification', 'email_digest', ?, ?)`,
    args: [now, now],
  })

  // ④ 돈 — 결제·회비는 회계 증빙이라 남고, 결제 수단(빌링키)만 사라진다.
  await client.execute({
    sql: `INSERT INTO payments (id, order_id, user_id, kind, order_name, amount, status, created_at, updated_at)
          VALUES ('pay1', 'ord-1', 'm1', 'dues', '2026-09 회비', 30000, 'done', ?, ?)`,
    args: [now, now],
  })
  await client.execute({
    sql: `INSERT INTO membership_dues (id, user_id, billing_month, amount, status, created_at, updated_at)
          VALUES ('due1', 'm1', '2026-09', 30000, 'paid', ?, ?)`,
    args: [now, now],
  })
  await client.execute({
    sql: `INSERT INTO billing_keys (id, user_id, billing_key, customer_key, created_at, updated_at)
          VALUES ('bk1', 'm1', 'bk_test', 'cust-1', ?, ?)`,
    args: [now, now],
  })
}

async function countOf(client, table, where, args) {
  const result = await client.execute({
    sql: `SELECT count(*) n FROM "${table}" WHERE ${where}`,
    args,
  })
  return Number(result.rows[0].n)
}

/**
 * ② 콘텐츠·조합 기록 7종 전체(글·댓글·좋아요·회의·회의록·서류·출석)의 스냅샷.
 * `withdrawMember`가 이 표들을 **한 건도 UPDATE하지 않는다**는 것을 전후
 * 비교로 못박는다 — 표 하나를 빼먹으면 그 표에 대한 회귀를 잡을 수단이
 * 없어진다는 리뷰 지적을 반영한다.
 */
const CONTENT_TABLES_SNAPSHOT_SQL = {
  posts: 'SELECT id, title, content, author_id FROM posts ORDER BY id',
  comments: 'SELECT id, post_id, author_id, content FROM comments ORDER BY id',
  post_likes: 'SELECT id, post_id, user_id FROM post_likes ORDER BY id',
  board_meetings: 'SELECT id, title, created_by FROM board_meetings ORDER BY id',
  board_minutes: 'SELECT id, meeting_id, content, author_id FROM board_minutes ORDER BY id',
  board_documents: 'SELECT id, title, file_path, uploaded_by FROM board_documents ORDER BY id',
  board_meeting_attendees:
    'SELECT id, meeting_id, member_id, attended FROM board_meeting_attendees ORDER BY id',
}

async function snapshotContentTables(client) {
  const snapshot = {}
  for (const [table, sql] of Object.entries(CONTENT_TABLES_SNAPSHOT_SQL)) {
    snapshot[table] = (await client.execute(sql)).rows.map(r => ({ ...r }))
  }
  return snapshot
}

test('확정은 신원을 지우고 로그를 지우되 콘텐츠·조합 기록 7종은 한 건도 바꾸지 않는다', async () => {
  await seedWithdrawalFixture(setupClient)

  const contentTablesBefore = await snapshotContentTables(setupClient)

  const { withdrawMember } = await import(WITHDRAWAL_MODULE_URL.href)
  assert.deepEqual(await withdrawMember('m1'), { ok: true, revokedBillingKeys: ['bk_test'] })

  // ① 신원 — 전부 비워졌다
  const p = (await setupClient.execute("SELECT * FROM member_profiles WHERE id='m1'")).rows[0]
  for (const col of [
    'real_name',
    'phone_number',
    'birth_date',
    'bank_name',
    'account_number',
    'account_holder',
    'monthly_fee',
    'last_login_at',
    'suspension_reason',
    'suspension_until',
    'artist_id',
    'director_title',
  ]) {
    assert.equal(p[col], null, `${col}이 남았다`)
  }
  assert.equal(p.display_name, '탈퇴한 조합원')
  assert.equal(p.email, 'withdrawn+m1@ggac.invalid')
  assert.equal(p.registration_status, 'withdrawn')
  assert.equal(p.is_active, 0)
  assert.equal(p.is_admin, 0)
  assert.equal(p.is_member, 0)
  assert.equal(p.is_artist, 0)
  assert.equal(p.is_director, 0)
  assert.equal(p.is_auditor, 0)
  assert.equal(p.is_suspended, 0)
  assert.equal(p.verification_status, '{"email":false,"phone":false,"identity":false}')
  assert.ok(p.withdrawn_at > 0)
  // `artist_role`은 NOT NULL default 'owner'라 NULL로 둘 수 없다.
  assert.equal(p.artist_role, 'owner')

  // ② 콘텐츠·조합 기록 7종 — 한 건도 안 바뀌었다. 작성자·업로더·출석 참조는
  // 묘비를 가리킨 채 남는다.
  const contentTablesAfter = await snapshotContentTables(setupClient)
  assert.deepEqual(contentTablesAfter, contentTablesBefore)

  // ③ 로그 — 전부 사라졌다
  for (const t of [
    'user_activities',
    'user_sessions',
    'daily_activity_stats',
    'notifications',
    'user_settings',
  ]) {
    assert.equal(await countOf(setupClient, t, "user_id='m1'"), 0, `${t}에 행이 남았다`)
  }
  // 남의 알림은 남되, 이 사람을 가리키던 참조만 끊긴다.
  assert.equal(await countOf(setupClient, 'notifications', "id='n2'"), 1)
  assert.equal(await countOf(setupClient, 'notifications', "related_user_id='m1'"), 0)

  // ④ 돈 — 결제·회비는 남고 빌링키만 사라졌다
  assert.equal(await countOf(setupClient, 'payments', "user_id='m1'"), 1)
  assert.equal(await countOf(setupClient, 'membership_dues', "user_id='m1'"), 1)
  assert.equal(await countOf(setupClient, 'billing_keys', "user_id='m1'"), 0)

  // 로그인 수단 — 사라졌다
  assert.equal(await countOf(setupClient, 'account', "user_id='m1'"), 0)
  assert.equal(await countOf(setupClient, 'session', "user_id='m1'"), 0)

  // Better Auth의 user 행도 묘비가 된다 — 여기 이메일이 남으면 로그인·메일이 살아 있다.
  const u = (await setupClient.execute("SELECT * FROM user WHERE id='m1'")).rows[0]
  assert.equal(u.email, 'withdrawn+m1@ggac.invalid')
  assert.equal(u.name, '탈퇴한 조합원')
  assert.equal(u.image, null)
  assert.equal(u.email_verified, 0)

  // 다른 조합원은 손대지 않는다.
  const other = (await setupClient.execute("SELECT * FROM member_profiles WHERE id='m2'")).rows[0]
  assert.equal(other.real_name, '김관리')
  assert.equal(other.registration_status, 'approved')
})

test('신청하지 않은 회원은 확정되지 않는다', async () => {
  await seedWithdrawalFixture(setupClient, { targetStatus: 'approved' })

  const { withdrawMember } = await import(WITHDRAWAL_MODULE_URL.href)
  assert.deepEqual(await withdrawMember('m1'), { ok: false, reason: 'not_requested' })

  const p = (
    await setupClient.execute(
      "SELECT registration_status s, real_name r FROM member_profiles WHERE id='m1'"
    )
  ).rows[0]
  assert.equal(p.s, 'approved', '상태가 바뀌면 안 된다')
  assert.notEqual(p.r, null, '개인정보가 지워지면 안 된다')
  // 신청 상태가 아니면 로그·빌링키도 그대로 남아 있어야 한다.
  assert.equal(await countOf(setupClient, 'user_activities', "user_id='m1'"), 2)
  assert.equal(await countOf(setupClient, 'billing_keys', "user_id='m1'"), 1)
})

test('마지막 관리자는 탈퇴 확정되지 않는다', async () => {
  // 관리자는 m2 하나뿐이고, 그가 신청 상태다 — 확정하면 조합이 잠긴다.
  await seedWithdrawalFixture(setupClient, {
    targetStatus: 'approved',
    adminStatus: 'withdrawal_requested',
  })

  const { withdrawMember } = await import(WITHDRAWAL_MODULE_URL.href)
  assert.deepEqual(await withdrawMember('m2'), { ok: false, reason: 'last_admin' })

  const p = (await setupClient.execute("SELECT is_admin a FROM member_profiles WHERE id='m2'"))
    .rows[0]
  assert.equal(p.a, 1, '관리자 권한이 남아 있어야 한다')
})

test('다른 승인 관리자가 1명 남아 있으면 관리자도 탈퇴 확정된다', async () => {
  // 신청자 본인(m2)은 이 시점에 registration_status가 'withdrawal_requested'라
  // approved 집계에서 스스로 빠진다 — 그래서 "본인 말고 승인 관리자 1명(m3)"만
  // 있어도 탈퇴 후 관리자가 1명(m3) 남으므로 허용돼야 한다. `> 1`로 잘못
  // 쓰면 이 경우가 부당하게 차단된다(회귀 대상).
  await seedWithdrawalFixture(setupClient, {
    targetStatus: 'approved',
    adminStatus: 'withdrawal_requested',
  })
  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO member_profiles
            (id, email, display_name, real_name, registration_status, is_active, is_admin,
             created_at, updated_at)
          VALUES ('m3', 'm3@example.test', '회원 m3', '박관리', 'approved', 1, 1, ?, ?)`,
    args: [now, now],
  })

  const { withdrawMember } = await import(WITHDRAWAL_MODULE_URL.href)
  assert.deepEqual(await withdrawMember('m2'), { ok: true, revokedBillingKeys: [] })

  const p = (
    await setupClient.execute(
      "SELECT registration_status s, is_admin a FROM member_profiles WHERE id='m2'"
    )
  ).rows[0]
  assert.equal(p.s, 'withdrawn')
  assert.equal(p.a, 0)
  // 남은 관리자(m3)는 그대로다.
  const other = (
    await setupClient.execute(
      "SELECT registration_status s, is_admin a FROM member_profiles WHERE id='m3'"
    )
  ).rows[0]
  assert.equal(other.s, 'approved')
  assert.equal(other.a, 1)
})

test('개인정보가 남으면 던지고 전부 롤백된다', async () => {
  // 트랜잭션 후반(user 표 갱신)에서 던지게 만든다 — 그래야 앞에서 이미 지운
  // 로그와 이미 비운 신원이 **되살아나는지**를 볼 수 있다. 유령 계정에
  // 자리표시자 이메일을 먼저 점유시키면 `user.email`의 UNIQUE가 걸린다.
  await seedWithdrawalFixture(setupClient)
  const now = Date.now()
  await setupClient.execute({
    sql: `INSERT INTO user (id, name, email, created_at, updated_at)
          VALUES ('ghost', '유령', 'withdrawn+m1@ggac.invalid', ?, ?)`,
    args: [now, now],
  })

  const { withdrawMember } = await import(WITHDRAWAL_MODULE_URL.href)
  await assert.rejects(() => withdrawMember('m1'))

  const p = (
    await setupClient.execute(
      "SELECT registration_status s, real_name r, email e FROM member_profiles WHERE id='m1'"
    )
  ).rows[0]
  assert.equal(p.s, 'withdrawal_requested', '상태가 롤백돼야 한다')
  assert.notEqual(p.r, null, '개인정보가 롤백돼야 한다')
  assert.equal(p.e, 'm1@example.test', '이메일이 롤백돼야 한다')
  assert.ok(
    (await countOf(setupClient, 'user_activities', "user_id='m1'")) > 0,
    '로그가 롤백돼야 한다'
  )
  assert.equal(
    await countOf(setupClient, 'billing_keys', "user_id='m1'"),
    1,
    '빌링키가 롤백돼야 한다'
  )
  assert.equal(
    await countOf(setupClient, 'account', "user_id='m1'"),
    1,
    '로그인 수단이 롤백돼야 한다'
  )
})
