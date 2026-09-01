import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import {
  CHECK_INVARIANTS,
  allInvariants,
  checkInvariants,
  formatReport,
  hasViolations,
  profileCompletenessExpressionSql,
} from '../turso/check-invariants.mjs'

/**
 * Postgres → Turso 이전에서 사라진 **CHECK 제약 20개**를 두 갈래로 되짚은
 * 것에 대한 회귀 테스트.
 *
 * - 갈래 1(막기): 앱 계층의 값 검증 — `@/constants/memberProfile`,
 *   `src/db/queries/activities.ts`, `src/db/queries/sessions.ts`.
 * - 갈래 2(탐지): `scripts/turso/check-invariants.mjs`.
 *
 * **모든 단언에 부정 대조가 붙어 있다.** 검증을 지우면(또는 위반 값을 실제로
 * 밀어 넣으면) 반드시 실패한다 — 그러지 않으면 이 파일은 "제약이 지켜진다"고
 * 믿게만 만들고 아무것도 지키지 않는다. 이 저장소의 적대 감사(2026-08-27)가
 * 정확히 그 종류의 초록불 11개를 찾아냈다.
 */

const DB_PATH = 'scripts/testing/.missing-check-constraints.db'
const ACTIVITIES_MODULE_URL = new URL('../../src/db/queries/activities.ts', import.meta.url)
const SESSIONS_MODULE_URL = new URL('../../src/db/queries/sessions.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)
const CONSTANTS_MODULE_URL = new URL('../../src/constants/memberProfile.ts', import.meta.url)

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

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
async function seedProfile(overrides = {}) {
  const { upsertProfile } = await import(`${PROFILES_MODULE_URL.href}?t=${++seedCounter}`)
  const id = overrides.id ?? `chk-profile-${seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: '제약테스트회원',
    registration_status: 'approved',
    is_active: true,
    ...overrides,
  })
  return id
}

/** 한 불변식만 골라 돌린다. */
function only(constraint) {
  const invariant = allInvariants().find(i => i.constraint === constraint)
  assert.ok(invariant, `${constraint} 불변식이 목록에 없다`)
  return [invariant]
}

// ---------------------------------------------------------------------------
// 갈래 2 — 탐지기 자체
// ---------------------------------------------------------------------------

describe('check-invariants: 사라진 CHECK 20개를 전부 다룬다', () => {
  test('원본 제약 이름 20개가 빠짐없이 목록에 있다', () => {
    // 이름은 Postgres 최종 스키마 덤프
    // (~/ggac-backups/supabase-final-schema-20260901.sql, 3191~3885행)의
    // CONSTRAINT 이름 그대로다. 하나라도 빠지면 그 제약은 영원히 감시 밖이다.
    const expected = [
      'check_artist_role',
      'member_profiles_engagement_score_check',
      'member_profiles_membership_type_check',
      'member_profiles_monthly_fee_check',
      'member_profiles_profile_completeness_score_check',
      'member_profiles_registration_status_check',
      'valid_target_combination',
      'valid_session_state',
      'check_template_type',
      'chk_board_agenda_status',
      'chk_board_document_category',
      'chk_board_meeting_status',
      'valid_file_size',
      'valid_file_type',
      'valid_mime_type',
      'posts_category_check',
      'check_event_application_status',
      'member_bulk_operations_operation_type_check',
      'member_bulk_operations_status_check',
      'member_status_history_action_check',
    ]
    assert.equal(CHECK_INVARIANTS.length, 20)
    assert.deepEqual(
      [...CHECK_INVARIANTS.map(i => i.constraint)].sort(),
      [...expected].sort(),
      '사라진 CHECK 목록과 어긋난다'
    )
  })

  test('배점식은 0003 마이그레이션에서 뽑아 쓴다(정본을 세 번째로 베끼지 않는다)', async () => {
    // 배점식의 정본은 `src/db/queries/profileCompleteness.ts`이고, 0003
    // 마이그레이션의 리터럴이 그 정본과 문자 단위로 같다는 것은
    // `profileCompletenessBackfill.test.mjs`가 이미 못박고 있다. 그래서 여기서는
    // **탐지기가 그 리터럴을 정확히 뽑아 쓰는지**만 본다 — 두 고리가 이어지면
    // 탐지기가 쓰는 식 = 정본이다. 여기서 식을 또 렌더링해 비교하면 같은 단언을
    // 두 벌 유지하게 된다.
    const { readFileSync } = await import('node:fs')
    const migration = readFileSync(
      'src/db/migrations/0003_backfill_profile_completeness.sql',
      'utf8'
    )
    const match = migration.match(
      /^UPDATE `member_profiles` SET `profile_completeness_score` = (.*);$/m
    )
    assert.ok(match, '마이그레이션에서 배점식 UPDATE 문을 찾지 못했다')
    assert.equal(profileCompletenessExpressionSql(), match[1], '탐지기가 배점식을 잘못 뽑았다')
    // 뽑은 식이 진짜 SQL로 도는지도 본다(정규식이 절반만 잘라도 통과하면 안 된다).
    const evaluated = await setupClient.execute(
      `SELECT ${profileCompletenessExpressionSql()} AS score FROM member_profiles LIMIT 0`
    )
    assert.ok(evaluated.columns.includes('score'))
  })

  test('부정 대조: 위반 행을 실제로 넣으면 각 불변식이 잡아낸다', async () => {
    // 검사 하나하나가 정말로 "무는지"를 값을 넣어 증명한다. 술어 오타 하나면
    // 전부 조용히 0건을 보고할 텐데, 그 초록불은 아무 뜻이 없다.
    const cases = [
      {
        constraint: 'member_profiles_monthly_fee_check',
        seed: async () => seedProfile({ monthly_fee: 1 }),
      },
      {
        constraint: 'member_profiles_membership_type_check',
        seed: async () => {
          const id = await seedProfile()
          await setupClient.execute({
            sql: `UPDATE member_profiles SET membership_type = 'platinum' WHERE id = ?`,
            args: [id],
          })
        },
      },
      {
        constraint: 'check_artist_role',
        seed: async () => {
          const id = await seedProfile()
          await setupClient.execute({
            sql: `UPDATE member_profiles SET artist_role = 'boss' WHERE id = ?`,
            args: [id],
          })
        },
      },
      {
        constraint: 'member_profiles_engagement_score_check',
        seed: async () => {
          const id = await seedProfile()
          await setupClient.execute({
            sql: `UPDATE member_profiles SET engagement_score = -1 WHERE id = ?`,
            args: [id],
          })
        },
      },
      {
        constraint: 'member_profiles_profile_completeness_score_check',
        seed: async () => {
          const id = await seedProfile()
          await setupClient.execute({
            sql: `UPDATE member_profiles SET profile_completeness_score = 101 WHERE id = ?`,
            args: [id],
          })
        },
      },
      {
        constraint: 'valid_target_combination',
        seed: async () => {
          const id = await seedProfile()
          await setupClient.execute({
            sql: `INSERT INTO user_activities (id, user_id, action_type, target_type, target_id, metadata, created_at)
                  VALUES (?, ?, 'view', NULL, 'dangling-id', '{}', ?)`,
            args: [`act-${seedCounter}`, id, Date.now()],
          })
        },
      },
      {
        constraint: 'valid_session_state',
        seed: async () => {
          const id = await seedProfile()
          await setupClient.execute({
            sql: `INSERT INTO user_sessions (id, user_id, session_token, last_activity, is_active, login_at, logout_at, metadata)
                  VALUES (?, ?, ?, ?, 0, ?, NULL, '{}')`,
            args: [`sess-${seedCounter}`, id, `tok-${seedCounter}`, Date.now(), Date.now()],
          })
        },
      },
    ]

    for (const { constraint, seed } of cases) {
      const before = await checkInvariants(setupClient, only(constraint))
      assert.equal(before[0].status, 'ok', `${constraint}: 시작 상태가 깨끗해야 한다`)

      await seed()

      const after = await checkInvariants(setupClient, only(constraint))
      assert.equal(after[0].status, 'violated', `${constraint}: 위반 행을 넣었는데 못 잡았다`)
      assert.ok(after[0].violations >= 1)
      assert.ok(hasViolations(after))
    }

    // 정리 — 뒤따르는 테스트가 깨끗한 DB를 보도록.
    await setupClient.executeMultiple(`
      DELETE FROM user_activities;
      DELETE FROM user_sessions;
      DELETE FROM member_profiles;
    `)
  })

  test('없는 표는 실패가 아니라 "건너뜀"이다', async () => {
    // member_status_history는 Turso로 넘어오지 않았다. 없는 표를 위반으로
    // 세면 매일 밤 거짓 경보가 울리고, 곧 아무도 이 검사를 안 본다.
    const results = await checkInvariants(setupClient, only('member_status_history_action_check'))
    assert.equal(results[0].status, 'missing-table')
    assert.equal(hasViolations(results), false)
  })

  test('보고서는 건수만 담고 행의 값은 담지 않는다', async () => {
    const id = await seedProfile({ id: 'pii-canary', display_name: '홍길동' })
    await setupClient.execute({
      sql: `UPDATE member_profiles SET membership_type = 'platinum' WHERE id = ?`,
      args: [id],
    })
    const report = formatReport(
      await checkInvariants(setupClient, only('member_profiles_membership_type_check'))
    )
    assert.match(report, /위반 1건/)
    // 이 스크립트 출력은 public 저장소의 Actions 로그에 그대로 찍힌다.
    assert.equal(report.includes('홍길동'), false, '보고서에 행의 값이 새어 나왔다')
    assert.equal(report.includes('platinum'), false, '보고서에 행의 값이 새어 나왔다')
    assert.equal(report.includes('pii-canary'), false, '보고서에 행 id가 새어 나왔다')
    await setupClient.executeMultiple('DELETE FROM member_profiles;')
  })
})

// ---------------------------------------------------------------------------
// 갈래 1 — 앱 계층
// ---------------------------------------------------------------------------

describe('monthly_fee: member_profiles_monthly_fee_check의 앱 재현', () => {
  test('범위 안은 통과, 밖은 거부, 빈 값은 NULL', async () => {
    const { parseMonthlyFee, MONTHLY_FEE_MIN, MONTHLY_FEE_MAX } = await import(
      CONSTANTS_MODULE_URL.href
    )

    assert.deepEqual(parseMonthlyFee(MONTHLY_FEE_MIN), { ok: true, value: MONTHLY_FEE_MIN })
    assert.deepEqual(parseMonthlyFee(MONTHLY_FEE_MAX), { ok: true, value: MONTHLY_FEE_MAX })
    assert.deepEqual(parseMonthlyFee('30000'), { ok: true, value: 30000 })

    // 원본 CHECK는 nullable 컬럼이라 NULL을 허용한다.
    for (const empty of [undefined, null, '']) {
      assert.deepEqual(parseMonthlyFee(empty), { ok: true, value: null })
    }

    // 부정 대조 — 예전 `mypage/profile`이 통과시키던 값들이다
    // (`parseIntegerParam(..., 0, { min: 0, max: 10_000_000 })`).
    // 0은 여기 없다 — 아래 별도 테스트가 다룬다(폼이 "없음"을 0으로 보낸다).
    for (const bad of [1, 9999, 50001, 10_000_000, 1.5, 'abc', {}]) {
      assert.deepEqual(
        parseMonthlyFee(bad),
        { ok: false },
        `${JSON.stringify(bad)}를 통과시켰다 — 예전 상한(0~10,000,000)으로 되돌아갔다`
      )
    }
  })

  test('0은 "회비 없음"이다 — 거부하면 조합원 4명이 프로필을 저장 못 한다', async () => {
    // 마이페이지 폼이 `profile.monthly_fee || 0`으로 초기화해서 회비가 없는
    // 조합원에 대해 **항상 0을 보낸다**(`ProfileEditForm.tsx:20,129`). 가입 폼도
    // 빈 값이면 `parseIntegerParam(..., 0, ...)`으로 0을 보낸다(`signup/page.tsx:271`).
    //
    // 그래서 0을 "범위 밖"으로 400 처리하면 그 조합원들은 이름·전화번호조차
    // 저장할 수 없고, 회비를 비운 가입도 400이 된다. 운영 실측(2026-09-01):
    // 회비가 NULL인 조합원 4명, **0인 행은 0건** — 0은 저장되는 값이 아니라
    // 폼이 "없음"을 표현하는 방식이다.
    const { parseMonthlyFee } = await import(CONSTANTS_MODULE_URL.href)

    for (const zero of [0, '0']) {
      assert.deepEqual(
        parseMonthlyFee(zero),
        { ok: true, value: null },
        `${JSON.stringify(zero)}을 거부하면 회비 없는 조합원이 프로필을 저장할 수 없다`
      )
    }
  })

  test('가입 라우트와 프로필 수정 라우트가 같은 상수를 본다', async () => {
    // 두 라우트가 각자 리터럴을 적고 있던 것이 이 구멍의 원인이었다:
    // 가입은 10000~50000, 프로필 수정은 0~10,000,000.
    const { readFileSync } = await import('node:fs')
    for (const route of [
      'src/app/api/member-signup/route.ts',
      'src/app/api/mypage/profile/route.ts',
    ]) {
      const source = readFileSync(route, 'utf8')
      assert.match(source, /parseMonthlyFee/, `${route}가 공용 파서를 쓰지 않는다`)
      assert.equal(/10_000_000|10000000/.test(source), false, `${route}에 옛 상한이 남아 있다`)
    }
  })
})

describe('artist_role: check_artist_role의 앱 재현', () => {
  test('허용 세 값만 통과한다', async () => {
    const { isValidArtistRole, ARTIST_ROLES } = await import(CONSTANTS_MODULE_URL.href)
    for (const role of ARTIST_ROLES) assert.equal(isValidArtistRole(role), true)
    for (const bad of ['boss', 'OWNER', '', null, undefined, 0]) {
      assert.equal(isValidArtistRole(bad), false, `${String(bad)}를 통과시켰다`)
    }
  })
})

describe('valid_target_combination: user_activities의 앱 재현', () => {
  test('target_type 없이 target_id만 있으면 쿼리 계층이 던진다', async () => {
    const { assertValidTargetCombination } = await import(ACTIVITIES_MODULE_URL.href)

    // 원본 CHECK가 허용하던 조합은 전부 통과해야 한다.
    assert.doesNotThrow(() => assertValidTargetCombination({}))
    assert.doesNotThrow(() => assertValidTargetCombination({ target_type: null, target_id: null }))
    assert.doesNotThrow(() => assertValidTargetCombination({ target_type: 'post', target_id: 'x' }))
    assert.doesNotThrow(() =>
      assertValidTargetCombination({ target_type: 'system', target_id: null })
    )

    // 금지 조합.
    assert.throws(
      () => assertValidTargetCombination({ target_type: null, target_id: 'orphan' }),
      /valid_target_combination/
    )
  })

  test('logUserActivity/logUserActivitiesBatch가 금지 조합을 DB에 남기지 않는다', async () => {
    const { logUserActivity, logUserActivitiesBatch } = await import(ACTIVITIES_MODULE_URL.href)
    const userId = await seedProfile()

    await assert.rejects(
      () => logUserActivity({ user_id: userId, action_type: 'view', target_id: 'orphan' }),
      /valid_target_combination/
    )
    await assert.rejects(
      () =>
        logUserActivitiesBatch(userId, [
          { action_type: 'view', target_type: 'post', target_id: 'ok' },
          { action_type: 'view', target_id: 'orphan' },
        ]),
      /valid_target_combination/
    )

    // 허용 조합은 그대로 기록된다(검증이 정상 경로를 막지 않는다).
    await logUserActivity({
      user_id: userId,
      action_type: 'view',
      target_type: 'post',
      target_id: 'ok',
    })
    await logUserActivity({ user_id: userId, action_type: 'login', target_type: 'system' })

    const results = await checkInvariants(setupClient, only('valid_target_combination'))
    assert.equal(results[0].status, 'ok', '금지 조합이 DB에 남았다')
    await setupClient.executeMultiple('DELETE FROM user_activities;')
  })
})

describe('valid_session_state: user_sessions의 앱 재현', () => {
  test('is_active와 logout_at을 따로 쓰려 하면 던진다', async () => {
    const { sessionState } = await import(SESSIONS_MODULE_URL.href)

    assert.deepEqual(sessionState(true, null), { isActive: true, logoutAt: null })
    const at = new Date()
    assert.deepEqual(sessionState(false, at), { isActive: false, logoutAt: at })

    // 부정 대조 — 원본 CHECK가 거부하던 두 조합.
    assert.throws(() => sessionState(false, null), /valid_session_state/)
    assert.throws(() => sessionState(true, new Date()), /valid_session_state/)
  })

  test('세션 시작·핑·종료를 거쳐도 위반 행이 생기지 않는다', async () => {
    const { manageUserSession } = await import(SESSIONS_MODULE_URL.href)
    const userId = await seedProfile()
    const token = `tok-state-${seedCounter}`

    await manageUserSession({ user_id: userId, session_token: token, action: 'start' })
    await manageUserSession({ user_id: userId, session_token: token, action: 'update' })
    await manageUserSession({ user_id: userId, session_token: token, action: 'end' })
    // 두 번째 로그인 — 앞선 활성 세션을 닫는 경로(짝을 맞춰야 하는 자리)도 탄다.
    await manageUserSession({ user_id: userId, session_token: `${token}-2`, action: 'start' })
    await manageUserSession({ user_id: userId, session_token: `${token}-3`, action: 'start' })

    const rows = await setupClient.execute('SELECT count(*) AS n FROM user_sessions')
    assert.ok(Number(rows.rows[0].n) >= 3, '세션이 실제로 기록되지 않았다면 이 검사는 공허하다')

    const results = await checkInvariants(setupClient, only('valid_session_state'))
    assert.equal(results[0].status, 'ok', formatReport(results))

    await setupClient.executeMultiple('DELETE FROM user_sessions; DELETE FROM user_activities;')
  })
})
