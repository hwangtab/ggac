-- 단계 4 최종 리뷰 B-7 — 성능 인덱스 이관
--
-- 정본은 Postgres 원본 `supabase/migrations/`의 `CREATE INDEX` 문들이다.
-- 0000(drizzle-kit push 산출물)은 **스키마에 선언된 UNIQUE 인덱스만** 만들었고,
-- 원본이 성능을 위해 따로 만들어 둔 인덱스는 하나도 넘어오지 않았다. 리뷰어가
-- `EXPLAIN QUERY PLAN`으로 실측한 결과 뜨거운 읽기 경로가 전부 풀스캔이었다 —
-- 로그인한 회원이 페이지를 열 때마다 `NotificationDropdown`이 부르는
-- `/api/notifications/stats`가 `SCAN notifications`였고, `notifications`는
-- **공지 1건당 승인 회원 수만큼 행이 늘어나는 상한 없는 표**다. 23명 규모에서는
-- 안 보이지만 선형으로 나빠진다.
--
-- ## 이 파일이 하는 일과 하지 않는 일
--
-- 인덱스 **생성만** 한다. 표를 재작성하지 않고, 행을 읽지도 쓰지도 않는다.
-- SQLite의 `CREATE INDEX`는 표 정의를 건드리지 않으므로 0002 같은 12단계 표
-- 재작성 절차가 필요 없다 — 만약 어떤 도구가 이 변경으로 표를 재작성하려
-- 든다면 그건 잘못된 것이다(Task 6a에서 `drizzle-kit generate` 생성물이
-- 데이터를 지울 뻔한 이력이 있다. 이 파일도 손으로 썼다).
--
-- 모든 문이 `IF NOT EXISTS`라 재실행 가능(idempotent)하다.
--
-- ## 원본을 그대로 옮기지 않은 것들 — 이유
--
-- 1. **부분 인덱스(`WHERE is_deleted = false` 등)는 선행 컬럼으로 바꿨다.**
--    SQLite도 부분 인덱스를 지원하지만, 질의의 WHERE가 인덱스의 WHERE를
--    **구문적으로 함의**해야만 사용한다. Drizzle이 만드는 조건은 `"is_deleted" = ?`
--    (바인딩 파라미터)이고, 바인딩 값은 계획 단계에서 상수로 취급되지 않아
--    부분 인덱스가 선택되지 않는다(실측). 그래서 필터 컬럼을 인덱스의 첫
--    컬럼으로 올리는 SQLite 관용 형태로 옮겼다 — 같은 질의를 같은 비용으로
--    처리하면서 `is_deleted = 1`(휴지통 조회)도 함께 탄다.
--    원본의 `WHERE (is_deleted = false OR is_deleted IS NULL)`에서 `IS NULL`
--    가지는 Turso 스키마에서 무의미하다(`is_deleted`가 `NOT NULL DEFAULT false`).
--
-- 2. **옮기지 않은 원본 인덱스**(근거는 `scripts/turso/README.md`의 표):
--    · Postgres 전용 — `idx_posts_search_gin`(tsvector), `idx_posts_title_trgm`·
--      `idx_posts_content_trgm`(pg_trgm). SQLite에 대응물이 없다. 게시판 검색은
--      현재 `LIKE` 기반이라 이 인덱스들이 있어도 쓰이지 않았다.
--    · 표가 없음 — `activity_logs`, `error_logs`, `member_login_history`,
--      `member_status_history`, `post_embedded_images`(이관 대상이 아니었다).
--    · 컬럼이 없음 — `idx_notifications_user_read`(원본은 `is_read`, Turso는
--      `read_at`), `idx_member_profiles_photo_url`(`profile_photo_url`은
--      `artists`에만 있다).
--    · 이 저장소의 어떤 질의도 쓰지 않음 — `idx_notifications_expires_at`
--      (`expires_at`을 읽는 질의가 0개), `idx_notifications_type`(`type`은 항상
--      `user_id`와 함께 걸러져 아래 `user_id` 선행 인덱스가 덮는다),
--      `idx_posts_like_count`·`idx_comments_like_count`(정렬·필터 대상이 아니다).
--      인덱스는 공짜가 아니다(쓰기마다 갱신) — 안 쓰이는 것을 옮기지 않는다.
--    · 이미 있는 UNIQUE 인덱스가 접두사로 덮음 — `idx_post_likes_post_id`·
--      `idx_post_likes_optimized`(`post_likes_post_user_idx`),
--      `idx_comment_likes_comment_id`(`comment_likes_comment_user_idx`),
--      `idx_board_attendees_meeting`(`board_meeting_attendees_meeting_member_idx`),
--      `idx_board_date_votes_option`(`board_meeting_date_votes_option_voter_idx`),
--      `idx_user_settings_user_id`·`idx_user_settings_user_category`
--      (`user_settings_user_category_key_idx`), `idx_artists_slug`·
--      `idx_artists_legacy_id`(`artists_slug_unique`·`artists_legacy_id_unique`),
--      `idx_member_profiles_email`(`member_profiles_email_idx`).
--
-- ## ⚠ 적용 방법 — `drizzle-kit migrate`로 적용하지 말 것
--
-- 0002·0003과 같다. 단언이 물었을 때 전체가 롤백되도록 `BEGIN`/`COMMIT`이
-- 스크립트 안에 있고, 마이그레이터가 자체 트랜잭션으로 감싸면 그 `BEGIN`이
-- `cannot start a transaction within a transaction`으로 즉시 실패해 전체가
-- 롤백된다(= 아무 일도 일어나지 않는다). `@libsql/client`의 `executeMultiple()`
-- 또는 `turso db shell`로 파일을 통째로 실행한다. 절차는
-- `scripts/turso/README.md`의 "단계 4 최종 리뷰 B-7" 절을 볼 것.
--
-- 검증은 마이그레이션 안에 들어 있다. `__migration_assert_0004`는
-- `CHECK (ok = 1)` 하나뿐인 표이고, ① 기대한 인덱스가 전부 생겼는지
-- ② 대상 표의 행 수가 하나도 변하지 않았는지(인덱스 생성은 데이터를 건드리지
-- 않는다 — 표를 재작성하는 생성물을 실수로 섞으면 여기서 잡힌다)
-- ③ 표가 재작성되지 않았는지(`__new_*` 임시 표가 없다)를 확인한다.
BEGIN;
--> statement-breakpoint
DROP TABLE IF EXISTS `__migration_assert_0004`;
--> statement-breakpoint
CREATE TABLE `__migration_assert_0004` (`ok` integer NOT NULL CHECK (`ok` = 1));
--> statement-breakpoint
DROP TABLE IF EXISTS `__migration_before_0004`;
--> statement-breakpoint
CREATE TABLE `__migration_before_0004` (`tbl` text NOT NULL, `n` integer NOT NULL);
--> statement-breakpoint
INSERT INTO `__migration_before_0004` (`tbl`, `n`)
SELECT 'posts', (SELECT count(*) FROM `posts`)
UNION ALL SELECT 'comments', (SELECT count(*) FROM `comments`)
UNION ALL SELECT 'post_likes', (SELECT count(*) FROM `post_likes`)
UNION ALL SELECT 'comment_likes', (SELECT count(*) FROM `comment_likes`)
UNION ALL SELECT 'notifications', (SELECT count(*) FROM `notifications`)
UNION ALL SELECT 'member_profiles', (SELECT count(*) FROM `member_profiles`)
UNION ALL SELECT 'post_attachments', (SELECT count(*) FROM `post_attachments`)
UNION ALL SELECT 'user_activities', (SELECT count(*) FROM `user_activities`)
UNION ALL SELECT 'board_agendas', (SELECT count(*) FROM `board_agendas`)
UNION ALL SELECT 'board_meeting_date_options', (SELECT count(*) FROM `board_meeting_date_options`)
UNION ALL SELECT 'board_documents', (SELECT count(*) FROM `board_documents`);
--> statement-breakpoint
-- posts — 게시판 목록(키셋)·작성자별 목록·기간 통계.
-- 원본: idx_posts_keyset_pagination / idx_posts_category_keyset_pagination /
--       idx_posts_optimized_list / idx_posts_author_id / idx_posts_created_at_not_deleted
-- (전부 `WHERE is_deleted = false` 부분 인덱스였다 — 위 1번 근거로 선행 컬럼화)
CREATE INDEX IF NOT EXISTS `idx_posts_keyset_pagination` ON `posts` (`is_deleted`, `is_pinned` DESC, `created_at` DESC, `id` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_posts_category_keyset_pagination` ON `posts` (`is_deleted`, `category`, `is_pinned` DESC, `created_at` DESC, `id` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_posts_author_id` ON `posts` (`author_id`, `is_deleted`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_posts_created_at_not_deleted` ON `posts` (`is_deleted`, `created_at` DESC);
--> statement-breakpoint
-- comments — 댓글 키셋 목록(post_id + created_at ASC + id ASC)과 내가 쓴 댓글.
-- 원본: idx_comments_post_id_created_at / idx_comments_post_keyset_pagination /
--       idx_comments_author_id
CREATE INDEX IF NOT EXISTS `idx_comments_post_id_created_at` ON `comments` (`post_id`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_comments_author_id` ON `comments` (`author_id`, `created_at` DESC);
--> statement-breakpoint
-- post_likes / comment_likes — 목록에 하트를 채우는 배치 조회
-- (`WHERE user_id = ? AND post_id IN (...)`). 기존 UNIQUE 인덱스는
-- (post_id, user_id)/(comment_id, user_id) 순서라 user_id 선행 조회를 못 탄다.
-- 원본: idx_post_likes_user_post_unique / idx_comment_likes_user_id
CREATE INDEX IF NOT EXISTS `idx_post_likes_user_post` ON `post_likes` (`user_id`, `post_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_comment_likes_user_comment` ON `comment_likes` (`user_id`, `comment_id`);
--> statement-breakpoint
-- notifications — 로그인 회원이 페이지를 열 때마다 도는 두 질의.
-- `idx_notifications_read_status`는 원본과 같은 (user_id, read_at)이고,
-- getNotificationStats의 집계(`WHERE user_id = ?` + read_at 분기)를 통째로 덮는다.
-- (user_id, created_at DESC)는 원본에 없다 — 원본은 (user_id)와 (created_at DESC)를
-- 따로 뒀는데, 이 저장소의 목록 질의는 항상 `WHERE user_id = ? ORDER BY created_at DESC`라
-- 두 개를 합친 형태가 정확히 그 질의를 덮는다(따로 두면 정렬이 임시 B-트리로 떨어진다).
CREATE INDEX IF NOT EXISTS `idx_notifications_user_created_at` ON `notifications` (`user_id`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_notifications_read_status` ON `notifications` (`user_id`, `read_at`);
--> statement-breakpoint
-- member_profiles — 관리자 회원 목록(상태 필터 + 가입일 정렬), 아티스트 배정 조회.
-- 원본: idx_member_profiles_status / idx_member_profiles_created_at /
--       idx_member_profiles_artist_id
-- (`idx_member_profiles_status`는 원본이 (registration_status, is_active)인데
--  (registration_status, created_at DESC)로 바꿨다 — `listProfiles`는 상태로만
--  거르고 항상 가입일 역순으로 정렬한다. 원본 형태로 두면 `is_active`가 중간에
--  끼어 정렬이 임시 B-트리로 떨어지는 것을 실측했다. `idx_board_date_options_meeting`에
--  `candidate_date`를 덧붙인 것도 같은 이유다.)
CREATE INDEX IF NOT EXISTS `idx_member_profiles_status` ON `member_profiles` (`registration_status`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_member_profiles_created_at` ON `member_profiles` (`created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_member_profiles_artist_id` ON `member_profiles` (`artist_id`);
--> statement-breakpoint
-- post_attachments — 글 상세의 첨부 목록, 임시 첨부 정리 배치.
-- 원본: idx_post_attachments_sort_order / idx_post_attachments_temp_cleanup
-- (후자는 `WHERE is_temporary = TRUE` 부분 인덱스였다 — 선행 컬럼화)
CREATE INDEX IF NOT EXISTS `idx_post_attachments_post_sort` ON `post_attachments` (`post_id`, `sort_order`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_post_attachments_temp_cleanup` ON `post_attachments` (`is_temporary`, `expires_at`);
--> statement-breakpoint
-- user_activities — 관리자 리포트(기간 조회)와 사용자별 활동.
-- 원본: idx_user_activities_created_at / idx_user_activities_composite
CREATE INDEX IF NOT EXISTS `idx_user_activities_created_at` ON `user_activities` (`created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_activities_composite` ON `user_activities` (`user_id`, `action_type`, `created_at` DESC);
--> statement-breakpoint
-- 이사회 — 회의별 안건·날짜 후보, 서류 목록.
-- 원본: idx_board_agendas_meeting / idx_board_date_options_meeting /
--       idx_board_documents_category
CREATE INDEX IF NOT EXISTS `idx_board_agendas_meeting` ON `board_agendas` (`meeting_id`, `sort_order`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_board_date_options_meeting` ON `board_meeting_date_options` (`meeting_id`, `candidate_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_board_documents_category` ON `board_documents` (`category`, `created_at` DESC);
--> statement-breakpoint
-- ① 기대한 인덱스가 전부 생겼는가.
INSERT INTO `__migration_assert_0004` (`ok`) SELECT CASE WHEN (
  SELECT count(*) FROM `sqlite_master`
   WHERE `type` = 'index' AND `name` IN (
     'idx_posts_keyset_pagination','idx_posts_category_keyset_pagination','idx_posts_author_id',
     'idx_posts_created_at_not_deleted','idx_comments_post_id_created_at','idx_comments_author_id',
     'idx_post_likes_user_post','idx_comment_likes_user_comment',
     'idx_notifications_user_created_at','idx_notifications_read_status',
     'idx_member_profiles_status','idx_member_profiles_created_at','idx_member_profiles_artist_id',
     'idx_post_attachments_post_sort','idx_post_attachments_temp_cleanup',
     'idx_user_activities_created_at','idx_user_activities_composite',
     'idx_board_agendas_meeting','idx_board_date_options_meeting','idx_board_documents_category'
   )
) = 20 THEN 1 ELSE 0 END;
--> statement-breakpoint
-- ② 행이 하나도 변하지 않았는가. 인덱스 생성은 데이터를 건드리지 않는다 —
--    표를 재작성하는 생성물을 실수로 섞으면(0002의 전례) 여기서 잡힌다.
INSERT INTO `__migration_assert_0004` (`ok`) SELECT CASE WHEN (
  SELECT count(*) FROM `__migration_before_0004` AS `b`
   WHERE `b`.`n` <> (
     SELECT CASE `b`.`tbl`
       WHEN 'posts' THEN (SELECT count(*) FROM `posts`)
       WHEN 'comments' THEN (SELECT count(*) FROM `comments`)
       WHEN 'post_likes' THEN (SELECT count(*) FROM `post_likes`)
       WHEN 'comment_likes' THEN (SELECT count(*) FROM `comment_likes`)
       WHEN 'notifications' THEN (SELECT count(*) FROM `notifications`)
       WHEN 'member_profiles' THEN (SELECT count(*) FROM `member_profiles`)
       WHEN 'post_attachments' THEN (SELECT count(*) FROM `post_attachments`)
       WHEN 'user_activities' THEN (SELECT count(*) FROM `user_activities`)
       WHEN 'board_agendas' THEN (SELECT count(*) FROM `board_agendas`)
       WHEN 'board_meeting_date_options' THEN (SELECT count(*) FROM `board_meeting_date_options`)
       WHEN 'board_documents' THEN (SELECT count(*) FROM `board_documents`)
     END
   )
) = 0 THEN 1 ELSE 0 END;
--> statement-breakpoint
-- ③ 표 재작성의 흔적(`__new_*` 임시 표)이 없는가.
INSERT INTO `__migration_assert_0004` (`ok`) SELECT CASE WHEN (
  SELECT count(*) FROM `sqlite_master` WHERE `name` LIKE '\_\_new\_%' ESCAPE '\'
) = 0 THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `__migration_before_0004`;
--> statement-breakpoint
DROP TABLE `__migration_assert_0004`;
--> statement-breakpoint
COMMIT;
