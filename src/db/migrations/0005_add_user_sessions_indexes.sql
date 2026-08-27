-- 컷오버 후 감사(2026-08-27) — `user_sessions` 인덱스 이관 누락 보완
--
-- 0004가 성능 인덱스 20개를 옮기면서 **`user_sessions`를 통째로 빠뜨렸다.**
-- 미이관 사유 목록에도 없으니 판단이 아니라 누락이다. Postgres 원본
-- `supabase/migrations/20250719090020_create_activity_tracking_system.sql:148-151`
-- 에는 이 표에 인덱스가 4개 있었다.
--
-- 실측(운영 Turso, 읽기 전용):
--   SELECT … WHERE user_id=? AND is_active=1            → SCAN user_sessions
--   SELECT … WHERE is_active=1 ORDER BY last_activity   → SCAN user_sessions
--   행 수 5,937
--
-- 이 표는 **로그인·세션 갱신마다 읽히고 가장 빨리 자란다.** 23명 규모에서는
-- 안 보이지만 로그인 한 번에 5,937행을 훑는 상태가 선형으로 나빠진다.
--
-- ## 이 파일이 하는 일과 하지 않는 일
--
-- 0004와 같다. 인덱스 **생성만** 한다 — 표를 재작성하지 않고 행을 읽지도 쓰지도
-- 않는다. 어떤 도구가 이 변경으로 표를 재작성하려 든다면 그건 잘못된 것이다
-- (Task 6a에서 `drizzle-kit generate` 생성물이 데이터를 지울 뻔했다. 이 파일도
-- 손으로 썼다). 모든 문이 `IF NOT EXISTS`라 재실행 가능하다.
--
-- ## 원본을 그대로 옮기지 않은 것 — 이유
--
-- 1. `idx_user_sessions_token`은 만들지 않는다. Drizzle 스키마의
--    `session_token` UNIQUE가 이미 같은 일을 한다(실측: 토큰 조회가
--    `user_sessions_session_token_unique`를 탄다). 0004도 기존 UNIQUE가 덮는
--    9개를 같은 이유로 제외했다.
-- 2. 원본 `idx_user_sessions_active`는 부분 인덱스(`WHERE is_active = TRUE`)다.
--    0004에서 확인한 대로 SQLite는 질의의 WHERE가 인덱스의 WHERE를 **구문적으로
--    함의**해야 부분 인덱스를 쓰는데, Drizzle이 만드는 조건은 바인딩 파라미터라
--    계획 단계에서 상수로 취급되지 않아 선택되지 않는다. 그래서 필터 컬럼을
--    선행 컬럼으로 올리는 SQLite 관용 형태로 옮겼다.
-- 3. 원본 `idx_user_sessions_user_id`(단일 컬럼)는 `(user_id, is_active)`로
--    합쳤다. 앱의 실제 조회가 항상 두 조건을 함께 걸고(`sessions.ts:93,171-173,
--    189-194`), 선행 컬럼이 `user_id`라 원본이 덮던 경우도 그대로 덮는다.
--
-- ## ⚠ 적용 방법 — 0002~0004와 같다(`drizzle-kit migrate` 금지)
--
-- 단언이 물었을 때 통째로 롤백되도록 `BEGIN`/`COMMIT`이 파일 안에 있다.
-- 마이그레이터가 자체 트랜잭션으로 감싸면 그 `BEGIN`이 즉시 실패해 전체가
-- 롤백된다(= 아무 일도 일어나지 않는다). 파일을 통째로 실행하는 경로로만 적용한다.
BEGIN;
--> statement-breakpoint
-- 적용 전 행 수를 남겨 두고, 끝에서 변하지 않았음을 스스로 단언한다.
CREATE TABLE `__migration_before_0005` (`n` integer NOT NULL);
--> statement-breakpoint
INSERT INTO `__migration_before_0005` (`n`) SELECT count(*) FROM `user_sessions`;
--> statement-breakpoint
CREATE TABLE `__migration_assert_0005` (`ok` integer NOT NULL CHECK (`ok` = 1));
--> statement-breakpoint
-- 로그인·세션 갱신의 뜨거운 경로: `WHERE user_id = ? AND is_active = ?`
CREATE INDEX IF NOT EXISTS `idx_user_sessions_user_active` ON `user_sessions` (`user_id`,`is_active`);
--> statement-breakpoint
-- 관리자 실시간·분석: `WHERE is_active = ? AND last_activity > ?` / ORDER BY last_activity
CREATE INDEX IF NOT EXISTS `idx_user_sessions_active_last_activity` ON `user_sessions` (`is_active`,`last_activity`);
--> statement-breakpoint
-- 원본 `idx_user_sessions_last_activity` 대응(활성 조건 없이 최근순만 볼 때)
CREATE INDEX IF NOT EXISTS `idx_user_sessions_last_activity` ON `user_sessions` (`last_activity`);
--> statement-breakpoint
-- ① 인덱스 3개가 실제로 생겼는가.
INSERT INTO `__migration_assert_0005` (`ok`) SELECT CASE WHEN (
  SELECT count(*) FROM `sqlite_master`
   WHERE `type` = 'index' AND `tbl_name` = 'user_sessions'
     AND `name` IN ('idx_user_sessions_user_active',
                    'idx_user_sessions_active_last_activity',
                    'idx_user_sessions_last_activity')
) = 3 THEN 1 ELSE 0 END;
--> statement-breakpoint
-- ② 행 수가 그대로인가 (인덱스 생성은 데이터를 건드리지 않는다).
INSERT INTO `__migration_assert_0005` (`ok`) SELECT CASE WHEN (
  (SELECT count(*) FROM `user_sessions`) = (SELECT `n` FROM `__migration_before_0005`)
) THEN 1 ELSE 0 END;
--> statement-breakpoint
-- ③ 표 재작성의 흔적(`__new_*` 임시 표)이 없는가.
INSERT INTO `__migration_assert_0005` (`ok`) SELECT CASE WHEN (
  SELECT count(*) FROM `sqlite_master` WHERE `name` LIKE '\_\_new\_%' ESCAPE '\'
) = 0 THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `__migration_before_0005`;
--> statement-breakpoint
DROP TABLE `__migration_assert_0005`;
--> statement-breakpoint
COMMIT;
