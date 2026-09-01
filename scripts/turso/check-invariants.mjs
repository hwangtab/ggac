import { readFileSync } from 'node:fs'

import { createClient } from '@libsql/client'

/**
 * Postgres → Turso 이전에서 **사라진 CHECK 제약 20개**를 읽기 전용 질의로
 * 되짚는다.
 *
 * ## 왜 이 파일이 있는가
 *
 * 이전 과정에서 `member_profiles`·`posts`·`post_attachments`·이사회 표에 걸려
 * 있던 CHECK 제약 20개가 통째로 사라졌다(운영 `sqlite_master` 전문에 `CHECK`
 * 문자열 0건). SQLite는 CHECK를 나중에 붙일 수 없고, 붙이려면 33개 표를
 * 재작성해야 한다 — 이 저장소는 바로 그 재작성 때문에 사고를 냈다(`0002`가
 * 이사회 표를 재작성하면서 나중에 추가된 컬럼과 인덱스를 지웠다). 그래서
 * **막는 일은 앱 계층(zod·상수 배열·parse 헬퍼)이 하고, 이 파일은 그 계층을
 * 우회한 쓰기를 사후에 잡아낸다.**
 *
 * 우회 경로는 실재한다: `turso db shell`로 손으로 친 UPDATE, `scripts/` 아래
 * 일회성 스크립트, 덤프 복원. 그런 쓰기는 라우트를 지나지 않으므로 앱 검증이
 * 아무리 촘촘해도 걸리지 않는다.
 *
 * ## 무엇을 세는가
 *
 * 각 항목은 **위반 행을 골라내는 WHERE 절**이다. 원본 CHECK 정의는
 * `~/ggac-backups/supabase-final-schema-20260901.sql`(3191~3885행)과
 * `supabase/migrations/`에 있고, 아래 술어는 그 부정(negation)이다.
 * NULL 취급도 원본을 따른다 — Postgres의 CHECK는 결과가 NULL이면 통과시키므로
 * (`monthly_fee`·`template_type`처럼) nullable 컬럼은 NULL을 위반으로 세지
 * 않는다.
 *
 * CHECK 20개에 더해 **파생값 불변식** 하나를 같이 본다:
 * `member_profiles.profile_completeness_score`가 배점식과 일치하는가. 이것은
 * CHECK가 아니라 Postgres 트리거가 지키던 것이고, 트리거도 이전 과정에서
 * 함께 사라졌다. 배점식의 정본은 `src/db/queries/profileCompleteness.ts`이며,
 * 여기서는 그 정본을 문자 단위로 렌더링해 둔 사본
 * (`src/db/migrations/0003_backfill_profile_completeness.sql`)에서 **식을 뽑아
 * 쓴다** — 규칙을 여기 다시 적으면 정본이 셋으로 늘어난다.
 * (그 사본이 정본과 일치한다는 것은 `profileCompletenessBackfill.test.mjs`가
 * 이미 문자 단위로 못박고 있다.)
 *
 * ## 절대 하지 않는 것
 *
 * - **쓰기.** 전부 `SELECT count(*)`다.
 * - **값 출력.** 이 저장소는 public이고 이 스크립트는 GitHub Actions 로그에
 *   찍힌다. 위반 행에는 조합원 실명·연락처·계좌가 들어 있을 수 있으므로
 *   **건수만** 보고한다. 어떤 행인지는 안전한 채널에서 따로 본다.
 */

const MIME_BY_FILE_TYPE = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  video: ['video/mp4', 'video/webm', 'video/ogg'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
}

/** `'a', 'b'` — SQL 리터럴 목록. 값은 전부 이 파일 안의 상수라 주입 위험이 없다. */
const list = values => values.map(v => `'${v}'`).join(', ')

/** `column`이 목록 밖일 때 참(= 위반). NULL은 원본 CHECK와 같이 통과시킨다. */
const notIn = (column, values) => `${column} IS NOT NULL AND ${column} NOT IN (${list(values)})`

const mimeMatchesFileType = Object.entries(MIME_BY_FILE_TYPE)
  .map(([type, mimes]) => `(file_type = '${type}' AND mime_type IN (${list(mimes)}))`)
  .join(' OR ')

/**
 * CHECK 20개. `constraint`는 Postgres에서 쓰던 제약 이름 그대로다 — 원본
 * 정의를 덤프에서 찾아볼 때의 열쇠다.
 */
export const CHECK_INVARIANTS = [
  {
    constraint: 'member_profiles_monthly_fee_check',
    table: 'member_profiles',
    where: 'monthly_fee IS NOT NULL AND (monthly_fee < 10000 OR monthly_fee > 50000)',
  },
  {
    constraint: 'posts_category_check',
    table: 'posts',
    where: notIn('category', ['공지', '잡담', '홍보', '건의']),
  },
  {
    constraint: 'member_profiles_registration_status_check',
    table: 'member_profiles',
    // `withdrawn`을 더했다. 앱의 `REGISTRATION_STATUSES`(정본)와 같아야 한다 —
    // 어긋나면 정상 데이터를 위반으로 보고하거나 그 반대가 된다. 탈퇴 "신청"은
    // 상태값이 아니라 `withdrawal_requested_at` 타임스탬프로 표현한다
    // (`0011_add_withdrawal_requested_at.sql` 참조) — 신청 중에도
    // `registration_status`는 `'approved'`로 남는다.
    where: notIn('registration_status', ['pending', 'approved', 'rejected', 'withdrawn']),
  },
  {
    constraint: 'member_profiles_membership_type_check',
    table: 'member_profiles',
    where: notIn('membership_type', ['regular', 'premium', 'lifetime']),
  },
  {
    constraint: 'check_artist_role',
    table: 'member_profiles',
    where: notIn('artist_role', ['owner', 'manager', 'collaborator']),
  },
  {
    constraint: 'member_profiles_profile_completeness_score_check',
    table: 'member_profiles',
    where: 'profile_completeness_score < 0 OR profile_completeness_score > 100',
  },
  {
    constraint: 'member_profiles_engagement_score_check',
    table: 'member_profiles',
    where: 'engagement_score < 0',
  },
  {
    constraint: 'chk_board_agenda_status',
    table: 'board_agendas',
    where: notIn('status', ['proposed', 'discussed', 'resolved']),
  },
  {
    constraint: 'chk_board_meeting_status',
    table: 'board_meetings',
    where: notIn('status', ['polling', 'scheduled', 'completed']),
  },
  {
    constraint: 'chk_board_document_category',
    table: 'board_documents',
    where: notIn('category', ['등록증', '정관', '계약', '총회', '기타']),
  },
  {
    constraint: 'check_template_type',
    table: 'artists',
    where: notIn('template_type', ['미니멀형', '콜라주형']),
  },
  {
    constraint: 'check_event_application_status',
    table: 'event_applications',
    where: notIn('status', ['pending', 'approved', 'rejected']),
  },
  {
    constraint: 'valid_file_size',
    table: 'post_attachments',
    where: 'file_size <= 0 OR file_size > 52428800',
  },
  {
    constraint: 'valid_file_type',
    table: 'post_attachments',
    where: notIn('file_type', Object.keys(MIME_BY_FILE_TYPE)),
  },
  {
    // file_type ↔ mime_type 교차검증. 원본은 네 조합의 OR였고, 어느 쪽도
    // 만족하지 않으면 위반이다. NULL이 섞이면 OR 전체가 NULL이라 Postgres에서
    // 통과했겠지만 두 컬럼 모두 NOT NULL이라 그 경우는 생기지 않는다.
    constraint: 'valid_mime_type',
    table: 'post_attachments',
    where: `NOT (${mimeMatchesFileType})`,
  },
  {
    constraint: 'valid_session_state',
    table: 'user_sessions',
    where:
      'NOT ((is_active = 1 AND logout_at IS NULL) OR (is_active = 0 AND logout_at IS NOT NULL))',
  },
  {
    // 원본: (target_type IS NULL AND target_id IS NULL) OR target_type IS NOT NULL.
    // 부정하면 "target_type은 없는데 target_id는 있다" 하나만 남는다.
    constraint: 'valid_target_combination',
    table: 'user_activities',
    where: 'target_type IS NULL AND target_id IS NOT NULL',
  },
  {
    constraint: 'member_bulk_operations_operation_type_check',
    table: 'member_bulk_operations',
    where: notIn('operation_type', [
      'bulk_approve',
      'bulk_reject',
      'bulk_activate',
      'bulk_deactivate',
      'bulk_suspend',
      'bulk_export',
    ]),
  },
  {
    constraint: 'member_bulk_operations_status_check',
    table: 'member_bulk_operations',
    where: notIn('status', ['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  },
  {
    // `member_status_history`는 Turso로 넘어오지 않았다(스키마·운영 모두에
    // 없다). 표가 없으면 아래 실행부가 "표 없음"으로 건너뛴다 — 목록에서
    // 빼 버리면 표가 되살아났을 때 아무도 이 제약을 다시 걸지 않는다.
    constraint: 'member_status_history_action_check',
    table: 'member_status_history',
    where: notIn('action', [
      'approve',
      'reject',
      'activate',
      'deactivate',
      'suspend',
      'unsuspend',
      'promote',
      'demote',
      'update',
    ]),
  },
]

const BACKFILL_SQL_PATH = new URL(
  '../../src/db/migrations/0003_backfill_profile_completeness.sql',
  import.meta.url
)

/**
 * 배점식을 `0003` 마이그레이션의 UPDATE 문에서 그대로 뽑는다. 정본은
 * `src/db/queries/profileCompleteness.ts`이고 그 파일과 이 SQL이 문자 단위로
 * 같다는 것은 `profileCompletenessBackfill.test.mjs`가 못박는다. 여기서 식을
 * 다시 적지 않는 이유가 그것이다 — 세 번째 사본을 만드는 순간 어긋나도
 * 아무도 모른다.
 */
export function profileCompletenessExpressionSql(path = BACKFILL_SQL_PATH) {
  const sql = readFileSync(path, 'utf8')
  const match = sql.match(/UPDATE `member_profiles` SET `profile_completeness_score` = (.+);\s*$/m)
  if (!match) {
    throw new Error(
      `배점식을 찾지 못했다: ${path}. 0003 마이그레이션의 UPDATE 문이 바뀌었는지 확인할 것.`
    )
  }
  return match[1]
}

/** CHECK가 아닌 파생값 불변식. */
export function derivedInvariants() {
  return [
    {
      constraint: 'profile_completeness_score = 배점식',
      table: 'member_profiles',
      where: `profile_completeness_score IS NOT ${profileCompletenessExpressionSql()}`,
    },
    {
      // Task 8. Postgres CHECK를 재현하는 것이 아니라 새로 추가하는 규칙이라
      // CHECK_INVARIANTS(원본 20개 목록)가 아니라 여기 둔다 —
      // `missingCheckConstraints.test.mjs`가 그 20개 목록의 이름을 문자
      // 단위로 못박고 있어, 새 규칙을 거기 섞으면 그 회귀 테스트가 깨진다.
      //
      // 앱을 지나지 않는 쓰기(손으로 친 SQL·일회성 스크립트)로 탈퇴 처리가
      // 반쪽만 된 경우 — 상태만 'withdrawn'으로 바뀌고 개인정보 삭제가
      // 빠진 경우 — 를 잡는다. 야간 백업 뒤 매일 돈다.
      constraint: 'withdrawn_rows_have_no_personal_data',
      table: 'member_profiles',
      where: `registration_status = 'withdrawn' AND (
        real_name IS NOT NULL OR phone_number IS NOT NULL OR
        birth_date IS NOT NULL OR account_number IS NOT NULL OR
        bank_name IS NOT NULL OR account_holder IS NOT NULL
      )`,
    },
  ]
}

export function allInvariants() {
  return [...CHECK_INVARIANTS, ...derivedInvariants()]
}

async function existingTables(client) {
  const rows = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  )
  return new Set(rows.rows.map(r => String(r.name)))
}

/**
 * 전 불변식을 돌려 결과 배열을 만든다. 각 항목은
 * `{ constraint, table, status: 'ok' | 'violated' | 'missing-table', violations }`.
 * **행의 값은 절대 담지 않는다** — 건수만이다.
 */
export async function checkInvariants(client, invariants = allInvariants()) {
  const tables = await existingTables(client)
  const results = []

  for (const invariant of invariants) {
    if (!tables.has(invariant.table)) {
      results.push({ ...invariant, status: 'missing-table', violations: 0 })
      continue
    }
    const rows = await client.execute(
      `SELECT count(*) AS n FROM "${invariant.table}" WHERE ${invariant.where}`
    )
    const violations = Number(rows.rows[0].n)
    results.push({ ...invariant, status: violations ? 'violated' : 'ok', violations })
  }

  return results
}

export function formatReport(results) {
  const lines = []
  const violated = results.filter(r => r.status === 'violated')
  const missing = results.filter(r => r.status === 'missing-table')
  const ok = results.filter(r => r.status === 'ok')

  for (const r of violated) {
    lines.push(`위반 ${r.violations}건 — ${r.table}.${r.constraint}`)
  }
  for (const r of missing) {
    lines.push(`표 없음(건너뜀) — ${r.table}.${r.constraint}`)
  }
  lines.push(
    violated.length
      ? `불변식 ${results.length}개 중 ${violated.length}개 위반 · ${ok.length}개 통과 · ${missing.length}개 건너뜀`
      : `불변식 ${results.length}개 전부 통과(건너뜀 ${missing.length}개)`
  )
  return lines.join('\n')
}

export function hasViolations(results) {
  return results.some(r => r.status === 'violated')
}

if (process.argv[1]?.endsWith('check-invariants.mjs')) {
  // 인자를 주지 않으면 `file:local.db`를 본다 — `db:parity`와 같은 관례다.
  // 운영을 보려면 URL을 명시해야 한다.
  const url = process.argv[2] ?? process.env.TURSO_DATABASE_URL ?? 'file:local.db'
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  try {
    const results = await checkInvariants(client)
    console.log(formatReport(results))
    process.exitCode = hasViolations(results) ? 1 : 0
  } finally {
    client.close()
  }
}
