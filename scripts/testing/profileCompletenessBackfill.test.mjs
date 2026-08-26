import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { migrationFiles } from './apply-migrations.mjs'

/**
 * 단계 4 Task 6b(수정 2회차) — `0003_backfill_profile_completeness.sql`이
 * **실제로 값을 고치는지**를 로컬 파일 DB에서 증명한다.
 *
 * "마이그레이션이 에러 없이 돌았다"는 증명이 아니다. 이 파일이 확인하는 것:
 *   ① 적용 **전** 세 종류의 행이 실제로 각각 0점 / 10점 누락 / 정확 상태인가
 *      (= 마이그레이션 이전에는 틀려 있었다는 사실 자체를 못박는다)
 *   ② 적용 **후** 셋 다 정확한 값이 되는가
 *   ③ 두 번 적용해도 같은 값인가 (멱등)
 *   ④ `updated_at`을 하나도 건드리지 않는가
 *   ⑤ **다섯 픽스처에 대해서만** 결과가 정본(`profileCompletenessExpression()`)과
 *      행마다 일치하는가 — 이 단언은 픽스처가 실제로 심어 둔 조합(가득 채움 /
 *      완전 미기입)에서만 두 사본을 비교하므로, 픽스처가 덮지 않는 배점 항목
 *      (`verification_status.phone`/`.identity`가 `true`인 행,
 *      `monthly_fee = 0`인 행, `bank_name`만 있고 `account_number`는 없는 행 등)이
 *      마이그레이션 SQL 리터럴에서만 달라져도 **여기서는 안 잡힌다.** 이 갭이
 *      수정 1회차의 결함이었다(재리뷰에서 6가지 변이 중 5가지가 값 대조를
 *      통과했다).
 *   ⑥ 그래서 ⑤와 별개로, 마이그레이션의 배점식 SQL **리터럴 자체**가 정본을
 *      `SQLiteSyncDialect`로 렌더링한 문자열과 **텍스트 단위로** 같은지
 *      직접 비교한다 — 이건 픽스처 조합에 좌우되지 않고 두 사본의 텍스트를
 *      곧바로 대조하므로, 어느 배점 항목이 갈리든 (그 항목이 픽스처에서
 *      실행되는지와 무관하게) 잡힌다. 실제 보장은 이 단언이 지고, ⑤는 "값이
 *      실제로 이 식으로 계산된다"는 별개의 사실(SQL 문자열이 아니라 그 문자열이
 *      낸 결과)을 확인하는 보조 대조다.
 *
 * **기대 점수는 구현이 아니라 원본 트리거 본문에서 손으로 뽑았다**
 * (`supabase/migrations/20250118090020_enhance_member_status_tracking.sql`
 * 202~219행). 구현에서 배점표를 베껴 오면 둘 다 틀린 채로 초록불이 된다.
 */

const DB_PATH = 'scripts/testing/.profile-completeness-backfill.db'
const BACKFILL_FILE = 'src/db/migrations/0003_backfill_profile_completeness.sql'

/** 원본 트리거 202~219행에서 손으로 옮긴 배점표. */
const POINTS = {
  display_name: 10,
  email: 10,
  real_name: 10,
  approved: 10,
  phone_number: 10,
  birth_date: 10,
  monthly_fee: 10,
  bank_and_account: 10,
  verified_email: 7,
  verified_phone: 7,
  verified_identity: 6,
}

/** 프로필 전 항목을 채운 승인 회원의 정답 점수. */
const FULL_APPROVED =
  POINTS.display_name +
  POINTS.email +
  POINTS.real_name +
  POINTS.approved +
  POINTS.phone_number +
  POINTS.birth_date +
  POINTS.monthly_fee +
  POINTS.bank_and_account +
  POINTS.verified_email

/** 표시명 + 이메일만 있는 승인 대기 회원의 정답 점수. */
const NAME_AND_EMAIL = POINTS.display_name + POINTS.email

/**
 * 심는 행. `storedScore`는 **이관돼 온 값**(= Postgres 시절 저장값)이고
 * `expected`는 배점표에서 손으로 계산한 정답이다.
 */
const FIXTURES = [
  {
    id: 'bf-zero',
    label: '(a) 점수 0인 행 — 원본의 WHERE score = 0이 잡던 대상',
    filled: true,
    storedScore: 0,
    expected: FULL_APPROVED,
  },
  {
    id: 'bf-stale-approved',
    label: '(b) 승인 10점이 빠진 행 — 원본 트리거의 한 박자 지연이 남긴 값',
    filled: true,
    storedScore: FULL_APPROVED - POINTS.approved,
    expected: FULL_APPROVED,
  },
  {
    id: 'bf-correct',
    label: '(c) 이미 정확한 행 — 건드리면 안 된다',
    filled: false,
    storedScore: NAME_AND_EMAIL,
    expected: NAME_AND_EMAIL,
  },
  {
    id: 'bf-overstated',
    label: '(d) 저장값이 정답보다 큰 행 — 소급 채움은 내리기도 해야 한다',
    filled: false,
    storedScore: 100,
    expected: NAME_AND_EMAIL,
  },
  {
    id: 'bf-broken-json',
    label: '(e) verification_status가 깨진 행 — 한 행 때문에 전체가 롤백되면 안 된다',
    filled: false,
    brokenJson: true,
    storedScore: 0,
    expected: NAME_AND_EMAIL,
  },
]

const SEEDED_UPDATED_AT = 1_700_000_000_000

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
}

/** 0003을 뺀 나머지 마이그레이션 — "소급 채움 이전" 상태를 만든다. */
async function applyMigrationsBeforeBackfill(client) {
  for (const file of migrationFiles()) {
    if (file.includes('0003_')) break
    await client.executeMultiple(readFileSync(file, 'utf8'))
  }
}

async function applyBackfill(client, { mutate } = {}) {
  const sql = readFileSync(BACKFILL_FILE, 'utf8')
  await client.executeMultiple(mutate ? mutate(sql) : sql)
}

function insertFixture(fixture) {
  const verification = fixture.brokenJson
    ? `'{"email": tru'`
    : fixture.filled
      ? `'{"email":true,"phone":false,"identity":false}'`
      : `'{}'`
  const filledColumns = fixture.filled
    ? `'홍길동','010-1234-5678','1990-01-01',30000,'농협','123-456-789'`
    : `NULL,NULL,NULL,NULL,NULL,NULL`
  return `
    INSERT INTO member_profiles
      (id, display_name, email, real_name, phone_number, birth_date, monthly_fee,
       bank_name, account_number, created_at, updated_at, artist_role, is_active,
       is_admin, is_suspended, is_member, is_artist, is_director, is_auditor,
       registration_status, profile_completeness_score, engagement_score,
       verification_status, membership_type)
    VALUES
      ('${fixture.id}','조합원 ${fixture.id}','${fixture.id}@backfill.test.local',
       ${filledColumns},
       ${SEEDED_UPDATED_AT}, ${SEEDED_UPDATED_AT}, 'owner',
       ${fixture.filled ? 1 : 0}, 0, 0, 1, 0, 0, 0,
       '${fixture.filled ? 'approved' : 'pending'}', ${fixture.storedScore}, 0,
       ${verification}, 'regular');
  `
}

async function seed(client) {
  await client.executeMultiple(FIXTURES.map(insertFixture).join('\n'))
}

async function scores(client) {
  const result = await client.execute(
    'SELECT id, profile_completeness_score AS score, updated_at FROM member_profiles ORDER BY id'
  )
  return new Map(
    result.rows.map(row => [
      String(row.id),
      { score: Number(row.score), updatedAt: Number(row.updated_at) },
    ])
  )
}

let client

before(async () => {
  cleanup()
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrationsBeforeBackfill(client)
  await seed(client)
})

after(() => {
  client?.close()
  cleanup()
})

// ---------------------------------------------------------------- ① 적용 전

test('적용 전: 심은 세 종류의 행 중 (c)만 정확하고 나머지는 실제로 틀려 있다', async () => {
  const before = await scores(client)
  for (const fixture of FIXTURES) {
    assert.equal(
      before.get(fixture.id).score,
      fixture.storedScore,
      `${fixture.label}: 시드가 의도한 저장값으로 들어가지 않았다`
    )
  }
  const wrong = FIXTURES.filter(f => f.storedScore !== f.expected).map(f => f.id)
  assert.deepEqual(
    wrong,
    ['bf-zero', 'bf-stale-approved', 'bf-overstated', 'bf-broken-json'],
    '적용 전에 틀린 행이 없으면 아래 "고쳤다"는 단언이 아무것도 증명하지 않는다'
  )
})

// ---------------------------------------------------------------- ②③④ 적용

test('적용 후: 다섯 행 모두 배점표대로가 되고, 두 번 돌려도 같다(멱등), updated_at은 그대로다', async () => {
  const before = await scores(client)

  await applyBackfill(client)
  const first = await scores(client)

  for (const fixture of FIXTURES) {
    assert.equal(first.get(fixture.id).score, fixture.expected, `${fixture.label}: 1회 적용 결과`)
  }

  // 실제로 값이 "바뀌었는지"를 따로 못박는다 — 정답과 같아졌다는 단언만으로는
  // 애초에 다 맞아 있었을 가능성을 배제하지 못한다.
  const changed = FIXTURES.filter(f => before.get(f.id).score !== first.get(f.id).score).map(
    f => f.id
  )
  assert.deepEqual(
    changed,
    ['bf-zero', 'bf-stale-approved', 'bf-overstated', 'bf-broken-json'],
    '마이그레이션이 실제로 고친 행의 집합'
  )
  assert.equal(
    first.get('bf-correct').score,
    before.get('bf-correct').score,
    '(c) 이미 정확한 행은 값이 그대로여야 한다'
  )

  for (const fixture of FIXTURES) {
    assert.equal(
      first.get(fixture.id).updatedAt,
      SEEDED_UPDATED_AT,
      `${fixture.label}: 파생 값 채우기가 updated_at을 밀면 안 된다`
    )
  }

  // 멱등 — 두 번째 적용은 아무것도 바꾸지 않는다.
  await applyBackfill(client)
  const second = await scores(client)
  assert.deepEqual(
    [...second.entries()],
    [...first.entries()],
    '2회 적용 결과가 1회 적용 결과와 달라지면 멱등이 아니다'
  )
})

test('적용 후: 임시 표(__migration_*)가 남지 않는다', async () => {
  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE name LIKE '__migration_%'"
  )
  assert.deepEqual(result.rows, [])
})

// ---------------------------------------------------------------- ⑤ 정본과의 대조

test('마이그레이션이 낸 값은 정본 profileCompletenessExpression()과 행마다 일치한다', async () => {
  process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
  const [{ db }, { memberProfiles }, { profileCompletenessExpression }] = await Promise.all([
    import('../../src/db/client.ts'),
    import('../../src/db/schema/index.ts'),
    import('../../src/db/queries/profileCompleteness.ts'),
  ])

  const rows = await db
    .select({
      id: memberProfiles.id,
      stored: memberProfiles.profileCompletenessScore,
      canonical: profileCompletenessExpression(),
    })
    .from(memberProfiles)

  assert.equal(rows.length, FIXTURES.length)
  for (const row of rows) {
    assert.equal(
      Number(row.stored),
      Number(row.canonical),
      `${row.id}: 마이그레이션의 SQL 리터럴 배점식이 정본과 갈렸다`
    )
  }
})

test('정본 대조: 마이그레이션의 배점식 리터럴은 profileCompletenessExpression()을 SQLiteSyncDialect로 렌더링한 것과 텍스트 단위로 같다', async () => {
  // 위 테스트(행마다 값 비교)는 다섯 픽스처가 실행하는 조합만 비교한다.
  // phone/identity 인증 가점, monthly_fee = 0, bank만 있고 account는 없는 행처럼
  // 픽스처가 심지 않은 조합은 그 값 비교로 못 잡는다(재리뷰 r2에서 실측: 6가지
  // 변이 중 5가지가 안 잡혔다). 그래서 값이 아니라 SQL 리터럴 텍스트 자체를
  // 직접 대조한다 — 어떤 배점 항목이 갈리든 픽스처 커버리지와 무관하게 잡힌다.
  const { SQLiteSyncDialect } = await import('drizzle-orm/sqlite-core')
  const { profileCompletenessExpression } = await import(
    '../../src/db/queries/profileCompleteness.ts'
  )

  const dialect = new SQLiteSyncDialect()
  const { sql: renderedSql, params } = dialect.sqlToQuery(profileCompletenessExpression().getSQL())

  // sqlToQuery는 값을 `?` 자리표시자로 빼내므로, 마이그레이션에 박힌 리터럴과
  // 비교하려면 params를 순서대로 다시 끼워 넣어야 한다. 이 정본 식의 파라미터는
  // 전부 가점(number) 아니면 JSON 경로 문자열('$.email' 등)이라 이 두 갈래만
  // 처리한다 — 다른 타입이 섞이면 이 비교 자체가 무의미해지므로 조용히
  // 넘어가지 않고 던진다.
  const toSqliteLiteral = value => {
    if (typeof value === 'number') return String(value)
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
    throw new Error(
      `profileCompletenessExpression() 파라미터에 예상 밖 타입이 섞였다: ${typeof value} (${value})`
    )
  }
  let paramIndex = 0
  const canonicalLiteral = renderedSql.replace(/\?/g, () => toSqliteLiteral(params[paramIndex++]))
  assert.equal(paramIndex, params.length, '렌더링된 SQL의 자리표시자 수가 params 수와 다르다')

  const migrationText = readFileSync(BACKFILL_FILE, 'utf8')
  const match = migrationText.match(
    /^UPDATE `member_profiles` SET `profile_completeness_score` = (.*);$/m
  )
  assert.ok(
    match,
    '마이그레이션에서 배점식 UPDATE 문을 찾지 못했다 — 정규식이 문서 형식 변화를 못 따라간 것일 수 있으니 확인해라'
  )

  assert.equal(
    match[1],
    canonicalLiteral,
    '마이그레이션의 배점식 SQL 리터럴이 정본(profileCompletenessExpression())을 ' +
      'SQLiteSyncDialect로 렌더링한 문자열과 텍스트 단위로 갈렸다 — 두 사본 중 하나만 고쳤다는 뜻이다'
  )
})

// ---------------------------------------------------------------- 부정 대조

test('부정 대조: 백필 UPDATE를 무력화하면 위 단언이 실제로 깨진다', async () => {
  const mutatedPath = `${DB_PATH}.mutated`
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${mutatedPath}${suffix}`, { force: true })
  const mutated = createClient({ url: `file:${mutatedPath}` })
  try {
    await applyMigrationsBeforeBackfill(mutated)
    await seed(mutated)
    // UPDATE 문만 주석 처리한다 — 단언·임시 표는 그대로 두므로, 마이그레이션은
    // 여전히 "에러 없이" 끝난다. 즉 이 대조는 "통과하니까 됐다"를 정확히
    // 반증한다.
    await applyBackfill(mutated, {
      mutate: sql => sql.replace(/^UPDATE `member_profiles` SET .*$/m, 'SELECT 1;'),
    })
    const after = await scores(mutated)
    for (const fixture of FIXTURES) {
      assert.equal(
        after.get(fixture.id).score,
        fixture.storedScore,
        `${fixture.label}: UPDATE를 지웠는데 값이 바뀌었다면 대조가 성립하지 않는다`
      )
    }
    const stillWrong = FIXTURES.filter(f => after.get(f.id).score !== f.expected).map(f => f.id)
    assert.deepEqual(
      stillWrong,
      ['bf-zero', 'bf-stale-approved', 'bf-overstated', 'bf-broken-json'],
      'UPDATE 없이도 정답이 나온다면 위 테스트는 마이그레이션을 증명하지 않는다'
    )
  } finally {
    mutated.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${mutatedPath}${suffix}`, { force: true })
  }
})

test('부정 대조: 원본의 WHERE profile_completeness_score = 0을 그대로 베끼면 (b)(d)가 안 고쳐진다', async () => {
  const mutatedPath = `${DB_PATH}.where0`
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${mutatedPath}${suffix}`, { force: true })
  const mutated = createClient({ url: `file:${mutatedPath}` })
  try {
    await applyMigrationsBeforeBackfill(mutated)
    await seed(mutated)
    await applyBackfill(mutated, {
      mutate: sql =>
        sql.replace(
          /^(UPDATE `member_profiles` SET .*);$/m,
          '$1 WHERE `profile_completeness_score` = 0;'
        ),
    })
    const after = await scores(mutated)
    assert.equal(after.get('bf-zero').score, FULL_APPROVED, '0인 행은 그 조건으로도 고쳐진다')
    assert.equal(
      after.get('bf-stale-approved').score,
      FULL_APPROVED - POINTS.approved,
      '승인 10점이 빠진 행은 WHERE = 0으로는 영원히 안 고쳐진다 — 이게 조건을 베끼지 않은 이유다'
    )
    assert.equal(after.get('bf-overstated').score, 100, '부풀려진 행도 그대로 남는다')
  } finally {
    mutated.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${mutatedPath}${suffix}`, { force: true })
  }
})

test('부정 대조: updated_at을 함께 미는 UPDATE로 바꾸면 마이그레이션 자체가 롤백된다', async () => {
  const mutatedPath = `${DB_PATH}.touch`
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${mutatedPath}${suffix}`, { force: true })
  const mutated = createClient({ url: `file:${mutatedPath}` })
  try {
    await applyMigrationsBeforeBackfill(mutated)
    await seed(mutated)
    await assert.rejects(
      () =>
        applyBackfill(mutated, {
          mutate: sql =>
            sql.replace(
              /^UPDATE `member_profiles` SET `profile_completeness_score` = /m,
              'UPDATE `member_profiles` SET `updated_at` = 1, `profile_completeness_score` = '
            ),
        }),
      /CHECK constraint failed/,
      '단언이 물지 않으면 이 마이그레이션의 "updated_at을 안 건드린다"는 서술은 근거가 없다'
    )
    const after = await scores(mutated)
    for (const fixture of FIXTURES) {
      assert.equal(after.get(fixture.id).score, fixture.storedScore, '롤백되어 저장값 그대로여야')
      assert.equal(after.get(fixture.id).updatedAt, SEEDED_UPDATED_AT)
    }
  } finally {
    mutated.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${mutatedPath}${suffix}`, { force: true })
  }
})
