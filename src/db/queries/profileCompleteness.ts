/**
 * `member_profiles.profile_completeness_score` 계산 — Postgres 트리거
 * `profile_completeness_trigger`(+ 그 본체 `calculate_profile_completeness`)의
 * 이식판.
 *
 * **원본**: `supabase/migrations/20250118090020_enhance_member_status_tracking.sql`
 * - 189~223행: `calculate_profile_completeness(member_id uuid) RETURNS integer`
 * - 225~239행: `update_profile_completeness()` + `BEFORE UPDATE` 트리거
 * - 241~244행: 기존 행 초기 채움(`UPDATE ... SET score = calculate(id)`)
 *
 * 이 파일이 유일한 정본이다. 배점표를 고칠 일이 생기면 여기만 고친다.
 *
 * ## 배점 (합계 100)
 *
 * | 항목 | 조건(원본 그대로) | 점수 |
 * |---|---|---|
 * | `display_name` | `IS NOT NULL AND LENGTH(...) > 0` | 10 |
 * | `email` | `IS NOT NULL AND LENGTH(...) > 0` | 10 |
 * | `real_name` | `IS NOT NULL AND LENGTH(...) > 0` | 10 |
 * | `registration_status` | `= 'approved'` | 10 |
 * | `phone_number` | `IS NOT NULL AND LENGTH(...) > 0` | 10 |
 * | `birth_date` | `IS NOT NULL` (길이 검사 없음) | 10 |
 * | `monthly_fee` | `IS NOT NULL AND ... > 0` | 10 |
 * | `bank_name` + `account_number` | **둘 다** `IS NOT NULL` (길이 검사 없음) | 10 |
 * | `verification_status->>'email'` | `= true` | 7 |
 * | `verification_status->>'phone'` | `= true` | 7 |
 * | `verification_status->>'identity'` | `= true` | 6 |
 *
 * 길이 검사가 붙은 컬럼과 NULL 검사만 하는 컬럼이 원본에서 실제로 갈린다
 * (`birth_date`·`monthly_fee`·`bank_name`·`account_number`에는 `LENGTH` 검사가
 * 없다). 옮기면서 "일관성 있게" 통일하고 싶어지는 지점이지만, 통일하는 순간
 * 이관된 기존 회원 23명의 점수와 신규 회원의 점수가 서로 다른 기준으로
 * 매겨진다 — 그 지표를 보고 "프로필이 덜 채워진 회원"을 고르는 관리자에게는
 * 그 불일치가 곧 오답이다. 원본과 한 칸도 다르지 않게 옮긴다.
 *
 * ## 원본과 의도적으로 다른 점 — 계산 시점의 스냅샷
 *
 * 원본 트리거는 `BEFORE UPDATE`인데 본체가 `SELECT * FROM member_profiles
 * WHERE id = NEW.id`로 **테이블을 다시 읽는다**. `BEFORE UPDATE` 시점에 그
 * SELECT가 보는 것은 아직 갱신되지 않은 행(OLD)이다 — 즉 원본은 갱신 **직전**
 * 값으로 점수를 매겨 항상 한 번씩 늦었다(예: 전화번호를 처음 입력한 UPDATE는
 * 전화번호가 없던 상태의 점수를 쓴다). 이 이식판은 배점 규칙은 그대로 두되
 * **갱신 직후 값**으로 계산한다. 원본의 지연은 규칙이 아니라 결함이고,
 * 그 결함까지 옮기면 화면에 뜨는 숫자가 회원이 방금 입력한 내용과 계속
 * 어긋난다.
 *
 * 이 차이가 기존 23명의 저장된 점수를 바꾸지는 않는다 — 그 값들은 위
 * 241~244행의 초기 채움 `UPDATE`가 만들었고, 그 문장에서 "갱신 직전 값"은
 * 곧 당시의 실제 값이라 이 이식판과 같은 결과다. 이후 그들의 프로필이 갱신될
 * 때 비로소 (더 정확한) 새 기준으로 다시 매겨진다.
 *
 * ## 왜 JS 함수가 아니라 SQL 식인가
 *
 * 원본이 트리거였던 것과 같은 이유다. `updateProfilesByIds`(관리자 일괄
 * 승인/거부)는 한 문장으로 여러 행을 바꾸는데, 점수를 JS에서 계산하려면
 * 바뀐 행을 전부 읽어 되돌려 쓰는 N+1이 생긴다 — `updateProfilesByIds`가
 * 애초에 없애려고 만든 바로 그 패턴이다. SQL 식이면 대상이 몇 행이든
 * `UPDATE ... SET score = <식>` 한 문장으로 끝난다.
 */

import { sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import { memberProfiles } from '../schema/index.ts'

/**
 * 컬럼을 **한정자 없는 식별자**로 렌더링한다. Drizzle는 컬럼 객체를
 * `"member_profiles"."display_name"`처럼 테이블 한정자를 붙여 렌더링하는데,
 * SQLite의 `UPDATE ... SET` 절 우변에서는 한정자 붙은 이름이 `no such column`
 * 으로 거부된다. 문자열을 직접 적는 대신 스키마의 컬럼 객체에서 이름을 뽑아
 * 쓰므로, 컬럼명이 바뀌면 여기도 같이 따라간다.
 */
const col = (column: AnySQLiteColumn): SQL => sql`${sql.identifier(column.name)}`

/** `조건`이 참일 때만 `points`를 더하는 항. */
const term = (condition: SQL, points: number): SQL =>
  sql`(case when ${condition} then ${points} else 0 end)`

/** 원본의 `x IS NOT NULL AND LENGTH(x) > 0`. */
const filledText = (column: AnySQLiteColumn, points: number): SQL =>
  term(sql`${col(column)} is not null and length(${col(column)}) > 0`, points)

/**
 * 원본의 `(verification_status->>'key')::boolean = true`.
 *
 * `verification_status`는 Postgres에서 jsonb였고 Turso에서는 JSON 문자열을
 * 담는 text다. jsonb 컬럼과 달리 text 컬럼은 깨진 JSON도 담을 수 있으므로
 * `json_valid()`로 먼저 거른다 — 없으면 `json_extract`가 `malformed JSON`으로
 * 던져서, 그 회원의 프로필 갱신 자체가 통째로 실패한다. 깨진 값은 "인증 안 됨"
 * (0점)으로 취급한다: 원본에서도 키가 없으면 `->>` 가 NULL이라 가점이 없었다.
 */
const verified = (key: 'email' | 'phone' | 'identity', points: number): SQL => {
  const column = col(memberProfiles.verificationStatus)
  return term(sql`json_valid(${column}) and json_extract(${column}, ${`$.${key}`}) = 1`, points)
}

/**
 * 행의 현재 값으로 `profile_completeness_score`를 계산하는 SQL 식(0~100).
 * `UPDATE member_profiles SET profile_completeness_score = <이 식>` 형태로만
 * 쓴다 — 같은 `UPDATE` 문의 다른 SET 항목과 섞어 쓰면 SQLite가 갱신 **전**
 * 값으로 식을 평가해(원본 트리거와 같은 지연) 의도한 결과가 나오지 않는다.
 */
export function profileCompletenessExpression(): SQL<number> {
  return sql<number>`(${sql.join(
    [
      // 기본 필수 항목 (40점)
      filledText(memberProfiles.displayName, 10),
      filledText(memberProfiles.email, 10),
      filledText(memberProfiles.realName, 10),
      term(sql`${col(memberProfiles.registrationStatus)} = 'approved'`, 10),
      // 연락처 (20점) — birth_date는 원본에 길이 검사가 없다.
      filledText(memberProfiles.phoneNumber, 10),
      term(sql`${col(memberProfiles.birthDate)} is not null`, 10),
      // 금융 정보 (20점) — 원본에 길이 검사가 없다(NULL 여부만 본다).
      term(
        sql`${col(memberProfiles.monthlyFee)} is not null and ${col(memberProfiles.monthlyFee)} > 0`,
        10
      ),
      term(
        sql`${col(memberProfiles.bankName)} is not null and ${col(memberProfiles.accountNumber)} is not null`,
        10
      ),
      // 인증 상태 (20점 = 7+7+6)
      verified('email', 7),
      verified('phone', 7),
      verified('identity', 6),
    ],
    sql` + `
  )})`
}
