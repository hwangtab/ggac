-- 단계 4 Task 6b(수정 1회차) — `profile_completeness_score` 전원 소급 채움
--
-- 배점표의 정본은 `src/db/queries/profileCompleteness.ts`의
-- `profileCompletenessExpression()`이고, 그 정본의 원본은 Postgres
-- `supabase/migrations/20250118090020_enhance_member_status_tracking.sql`
-- 189~223행(`calculate_profile_completeness`)이다. 아래 식은 그 함수를
-- 렌더링한 것과 **문자 단위로 같아야 한다** — 어긋나면
-- `scripts/testing/profileCompletenessBackfill.test.mjs`가 두 경로의 결과를
-- 행마다 대조해 실패한다(이 파일에 규칙을 다시 적는 순간 정본이 둘이 되므로,
-- 그 이중화를 테스트가 감시한다).
--
-- ## 왜 필요한가
--
-- 원본 마이그레이션은 트리거를 만든 **직후** 241~244행에서 기존 행 소급 채움을
-- 실제로 돌렸다. 이식판(0000~0002)에는 그에 해당하는 것이 없어서, Turso로
-- 옮겨온 회원들의 점수는 Postgres 시절 저장값 그대로다
-- (`scripts/migrate/lib/identityMapping.mjs`가 값을 그대로 옮긴다).
--
-- 그 저장값이 실제로 틀려 있다. 원본 트리거는 `BEFORE UPDATE`인데 본체가
-- 테이블을 다시 읽어(`SELECT * ... WHERE id = NEW.id`) **갱신 직전** 값으로
-- 점수를 매겼다 — 한 박자 늦었다. 이 지연은 승인 UPDATE에도 걸린다:
-- `registration_status`를 `'approved'`로 바꾸는 그 UPDATE가 보는 값은 아직
-- `'pending'`이라 승인 10점이 붙지 않는다. 그래서 **승인 이후 프로필을 한 번도
-- 고치지 않은 회원은 10점이 빠진 점수**로 남아 있다. 관리자 화면에서 "프로필이
-- 덜 채워진 회원"을 고르면 이미 다 채운 조합원이 계속 미달로 잡힌다.
--
-- ## 설계 판단 — 원본의 `WHERE profile_completeness_score = 0`을 베끼지 않았다
--
-- 원본은 0인 행만 채웠다. 그 조건은 "저장된 값이 없으면 채운다"는 뜻이고,
-- 트리거가 그 뒤를 계속 맞춰 준다는 전제 위에서만 성립한다. 지금 상황은
-- 다르다 — 위의 한 박자 지연 때문에 **0이 아니면서 틀린 값**(승인 10점 누락)이
-- 실재하고, 그게 정확히 고쳐야 할 대상이다. `= 0`을 베끼면 그 행들은 손도
-- 대지 않은 채 초록불만 난다.
--
-- 그렇다고 `= 0`을 다른 조건(예: 기대값과 다른 행만)으로 바꾸지도 않았다.
-- 이 마이그레이션이 보장하려는 것은 "틀려 보이는 행을 고쳤다"가 아니라
-- **"모든 행의 저장 점수 = 배점식의 값"이라는 전면 불변식**이다. WHERE 절은
-- 그 불변식이 적용되지 않는 행을 만들어 내는 유일한 통로이고, 원본이 남긴
-- 결함이 바로 그 통로에서 나왔다. 점수는 같은 행의 다른 컬럼들만으로 정해지는
-- 순수 함수이고 점수를 쓴다고 그 입력이 달라지지 않으므로, 조건 없는 UPDATE는
-- 몇 번을 돌려도 같은 값에 수렴한다(멱등).
--
-- ## 이 파일이 하지 않는 것
--
-- `updated_at`을 건드리지 않는다. 파생 값을 채우는 일이 "이 회원 정보가
-- 방금 바뀌었다"로 보이면 안 되기 때문이다(앱의 `recomputeCompleteness`도
-- 같은 이유로 `updated_at`을 자기 자신으로 못박는다). 아래 단언이 그것을
-- 실제로 확인한다.
--
-- ## 적용 방법 — `drizzle-kit migrate`로 적용하지 말 것
--
-- 0002와 같다. 단언이 물었을 때 UPDATE까지 통째로 롤백되도록 `BEGIN`/`COMMIT`이
-- 스크립트 안에 있고, 마이그레이터가 자체 트랜잭션으로 감싸면 그 `BEGIN`이
-- `cannot start a transaction within a transaction`으로 즉시 실패해 전체가
-- 롤백된다(= 아무 일도 일어나지 않는다). `@libsql/client`의 `executeMultiple()`
-- 또는 `turso db shell`로 파일을 통째로 실행한다. 절차는
-- `scripts/turso/README.md`를 볼 것.
--
-- 검증은 마이그레이션 안에 들어 있다. `__migration_assert_0003`은
-- `CHECK (ok = 1)` 하나뿐인 표이고, ① 행 수가 그대로인지 ② `updated_at`이
-- 하나도 안 바뀌었는지 ③ 결과 점수가 전부 0~100 안에 있는지를 여기에 INSERT해
-- 확인한다. 어긋나면 CHECK 위반으로 트랜잭션 전체가 롤백된다.
BEGIN;
--> statement-breakpoint
DROP TABLE IF EXISTS `__migration_assert_0003`;
--> statement-breakpoint
CREATE TABLE `__migration_assert_0003` (`ok` integer NOT NULL CHECK (`ok` = 1));
--> statement-breakpoint
DROP TABLE IF EXISTS `__migration_before_0003`;
--> statement-breakpoint
CREATE TABLE `__migration_before_0003` AS SELECT `id` AS `id`, `updated_at` AS `updated_at` FROM `member_profiles`;
--> statement-breakpoint
UPDATE `member_profiles` SET `profile_completeness_score` = ((case when "display_name" is not null and length("display_name") > 0 then 10 else 0 end) + (case when "email" is not null and length("email") > 0 then 10 else 0 end) + (case when "real_name" is not null and length("real_name") > 0 then 10 else 0 end) + (case when "registration_status" = 'approved' then 10 else 0 end) + (case when "phone_number" is not null and length("phone_number") > 0 then 10 else 0 end) + (case when "birth_date" is not null then 10 else 0 end) + (case when "monthly_fee" is not null and "monthly_fee" > 0 then 10 else 0 end) + (case when "bank_name" is not null and "account_number" is not null then 10 else 0 end) + (case when json_valid("verification_status") and json_extract("verification_status", '$.email') = 1 then 7 else 0 end) + (case when json_valid("verification_status") and json_extract("verification_status", '$.phone') = 1 then 7 else 0 end) + (case when json_valid("verification_status") and json_extract("verification_status", '$.identity') = 1 then 6 else 0 end));
--> statement-breakpoint
INSERT INTO `__migration_assert_0003` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `member_profiles`) = (SELECT count(*) FROM `__migration_before_0003`) THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO `__migration_assert_0003` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `member_profiles` AS `m` JOIN `__migration_before_0003` AS `b` ON `b`.`id` = `m`.`id` WHERE `m`.`updated_at` IS NOT `b`.`updated_at`) = 0 THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO `__migration_assert_0003` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `member_profiles` WHERE `profile_completeness_score` IS NULL OR `profile_completeness_score` < 0 OR `profile_completeness_score` > 100) = 0 THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `__migration_before_0003`;
--> statement-breakpoint
DROP TABLE `__migration_assert_0003`;
--> statement-breakpoint
COMMIT;
