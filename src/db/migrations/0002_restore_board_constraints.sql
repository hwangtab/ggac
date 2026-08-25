-- 단계 4 Task 6a — 이사회 스키마 제약 회복 (B-9 / B-10)
--
-- 정본은 Postgres 원본
-- `supabase/migrations/20260529090020_create_board_room_tables.sql`이다.
-- 되돌리는 제약:
--   · board_minutes.meeting_id UNIQUE (원본 컬럼 선언의 UNIQUE가 유실됨)
--   · board_meetings.created_by      NO ACTION → SET NULL
--   · board_agendas.proposed_by      NO ACTION → SET NULL
--   · board_minutes.author_id        NO ACTION → SET NULL
--   · board_documents.uploaded_by    NO ACTION → SET NULL
--   · board_meeting_attendees.member_id  CASCADE → NO ACTION
--   · board_meeting_date_votes.voter_id  CASCADE → NO ACTION
--
-- ⚠ 이 파일은 `drizzle-kit generate`가 뱉은 원문을 **손으로 고친 것**이다.
-- 생성물을 그대로 쓰면 안 되는 이유(로컬 파일 DB 실측):
--   drizzle는 첫 표 블록 뒤에 `PRAGMA foreign_keys=ON`을 넣고 나머지 5개
--   표를 FK가 켜진 채로 재작성한다. SQLite는 FK가 켜져 있으면 `DROP TABLE`
--   전에 암묵적 DELETE를 수행하고 그 DELETE가 FK 액션을 발동시킨다 —
--   `DROP TABLE board_meetings`가 자식 표를 **CASCADE로 전부 지운다.**
--   실측: 각 1행씩 심어 두고 생성물 원문을 돌리면 board_agendas·
--   board_minutes·board_meeting_attendees·board_meeting_date_options·
--   board_meeting_date_votes가 전부 0행이 됐다.
-- 그래서 `PRAGMA foreign_keys=OFF`는 스크립트 전체를 감싸고,
-- `=ON` 복원은 맨 끝 한 번만 한다(SQLite 문서의 12단계 표 재작성 절차).
--
-- 재실행 가능(idempotent): 표 블록은 `__new_*`를 먼저 지우고 시작하며,
-- 두 번 돌려도 같은 스키마·같은 행에 수렴한다. 재작성 전체가 하나의
-- 트랜잭션이라 중간에 죽어도 DROP↔RENAME 사이의 표 유실이 없다.
--
-- 검증은 마이그레이션 안에 들어 있다: `__migration_assert_0002`는 `CHECK (ok = 1)`
-- 뿐인 표이고, 표마다 재작성 전후 행 수가 같은지, 마지막에 FK 위반이 0인지
-- 이 표에 INSERT해서 확인한다. 어긋나면 CHECK 위반으로 트랜잭션 전체가
-- 롤백된다.
--
-- 적용은 `@libsql/client`의 `executeMultiple()`(또는 `turso db shell`)로
-- 한다. **`drizzle-kit migrate`로 적용하면 안 된다** — 마이그레이터가 자체
-- 트랜잭션으로 감싸면 `PRAGMA foreign_keys`가 조용히 무시되고 위의 CASCADE
-- 참사가 그대로 재현된다.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
BEGIN;
--> statement-breakpoint
DROP TABLE IF EXISTS `__migration_assert_0002`;
--> statement-breakpoint
CREATE TABLE `__migration_assert_0002` (`ok` integer NOT NULL CHECK (`ok` = 1));
--> statement-breakpoint
DROP TABLE IF EXISTS `__new_board_agendas`;
--> statement-breakpoint
CREATE TABLE `__new_board_agendas` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`proposed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_board_agendas`("id", "meeting_id", "title", "content", "sort_order", "status", "proposed_by", "created_at", "updated_at") SELECT "id", "meeting_id", "title", "content", "sort_order", "status", "proposed_by", "created_at", "updated_at" FROM `board_agendas`;
--> statement-breakpoint
INSERT INTO `__migration_assert_0002` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_agendas`) = (SELECT count(*) FROM `board_agendas`) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `board_agendas`;
--> statement-breakpoint
ALTER TABLE `__new_board_agendas` RENAME TO `board_agendas`;
--> statement-breakpoint
DROP TABLE IF EXISTS `__new_board_documents`;
--> statement-breakpoint
CREATE TABLE `__new_board_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text,
	`file_size` integer,
	`mime_type` text,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_board_documents`("id", "title", "category", "file_path", "file_name", "file_size", "mime_type", "uploaded_by", "created_at") SELECT "id", "title", "category", "file_path", "file_name", "file_size", "mime_type", "uploaded_by", "created_at" FROM `board_documents`;
--> statement-breakpoint
INSERT INTO `__migration_assert_0002` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_documents`) = (SELECT count(*) FROM `board_documents`) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `board_documents`;
--> statement-breakpoint
ALTER TABLE `__new_board_documents` RENAME TO `board_documents`;
--> statement-breakpoint
DROP TABLE IF EXISTS `__new_board_meeting_attendees`;
--> statement-breakpoint
CREATE TABLE `__new_board_meeting_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`member_id` text NOT NULL,
	`attended` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_board_meeting_attendees`("id", "meeting_id", "member_id", "attended", "created_at", "updated_at") SELECT "id", "meeting_id", "member_id", "attended", "created_at", "updated_at" FROM `board_meeting_attendees`;
--> statement-breakpoint
INSERT INTO `__migration_assert_0002` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_meeting_attendees`) = (SELECT count(*) FROM `board_meeting_attendees`) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `board_meeting_attendees`;
--> statement-breakpoint
ALTER TABLE `__new_board_meeting_attendees` RENAME TO `board_meeting_attendees`;
--> statement-breakpoint
CREATE UNIQUE INDEX `board_meeting_attendees_meeting_member_idx` ON `board_meeting_attendees` (`meeting_id`,`member_id`);
--> statement-breakpoint
DROP TABLE IF EXISTS `__new_board_meeting_date_votes`;
--> statement-breakpoint
CREATE TABLE `__new_board_meeting_date_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`option_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`is_available` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`option_id`) REFERENCES `board_meeting_date_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voter_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_board_meeting_date_votes`("id", "option_id", "voter_id", "is_available", "created_at", "updated_at") SELECT "id", "option_id", "voter_id", "is_available", "created_at", "updated_at" FROM `board_meeting_date_votes`;
--> statement-breakpoint
INSERT INTO `__migration_assert_0002` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_meeting_date_votes`) = (SELECT count(*) FROM `board_meeting_date_votes`) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `board_meeting_date_votes`;
--> statement-breakpoint
ALTER TABLE `__new_board_meeting_date_votes` RENAME TO `board_meeting_date_votes`;
--> statement-breakpoint
CREATE UNIQUE INDEX `board_meeting_date_votes_option_voter_idx` ON `board_meeting_date_votes` (`option_id`,`voter_id`);
--> statement-breakpoint
DROP TABLE IF EXISTS `__new_board_meetings`;
--> statement-breakpoint
CREATE TABLE `__new_board_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`meeting_date` text,
	`location` text,
	`status` text DEFAULT 'polling' NOT NULL,
	`vote_deadline` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_board_meetings`("id", "title", "meeting_date", "location", "status", "vote_deadline", "created_by", "created_at", "updated_at") SELECT "id", "title", "meeting_date", "location", "status", "vote_deadline", "created_by", "created_at", "updated_at" FROM `board_meetings`;
--> statement-breakpoint
INSERT INTO `__migration_assert_0002` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_meetings`) = (SELECT count(*) FROM `board_meetings`) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `board_meetings`;
--> statement-breakpoint
ALTER TABLE `__new_board_meetings` RENAME TO `board_meetings`;
--> statement-breakpoint
DROP TABLE IF EXISTS `__new_board_minutes`;
--> statement-breakpoint
CREATE TABLE `__new_board_minutes` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`content` text,
	`content_format` text,
	`author_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_board_minutes`("id", "meeting_id", "content", "content_format", "author_id", "created_at", "updated_at") SELECT "id", "meeting_id", "content", "content_format", "author_id", "created_at", "updated_at" FROM `board_minutes`;
--> statement-breakpoint
INSERT INTO `__migration_assert_0002` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_minutes`) = (SELECT count(*) FROM `board_minutes`) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `board_minutes`;
--> statement-breakpoint
ALTER TABLE `__new_board_minutes` RENAME TO `board_minutes`;
--> statement-breakpoint
CREATE UNIQUE INDEX `board_minutes_meeting_id_idx` ON `board_minutes` (`meeting_id`);
--> statement-breakpoint
INSERT INTO `__migration_assert_0002` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_foreign_key_check()) = 0 THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `__migration_assert_0002`;
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
