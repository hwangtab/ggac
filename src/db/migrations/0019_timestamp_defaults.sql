-- created_at / updated_at 에 SQL DEFAULT 를 붙인다 — 표 32개 재작성.
--
-- ## 왜
--
-- 앱 표의 `created_at`·`updated_at`은 NOT NULL 인데 SQL DEFAULT 가 없고 Drizzle 의
-- `$defaultFn` 에만 기댔다. Drizzle 을 거치는 쓰기는 괜찮지만, 그렇지 않은 쓰기 —
-- `turso db shell`, `scripts/turso/*`, 복구·백필 — 는 전부
-- `NOT NULL constraint failed` 로 죽는다. Better Auth 표(`user` 등)는 처음부터
-- DEFAULT 를 갖고 있어 같은 저장소 안에 두 관례가 공존했다.
--
-- SQLite 는 컬럼 정의를 바꿀 수 없으므로(ALTER COLUMN 없음) 표를 재작성한다.
--
-- ## 어떻게 만들었나 — 손으로 쓰지 않았다
--
-- `0002` 가 이사회 표를 재작성하면서 나중에 붙은 컬럼과 인덱스를 지운 사고가
-- 있다(그 파일 상단 참고). 같은 오류 계열을 피하려고 이 파일은 0000~0017 을
-- 적용한 빈 DB 의 `sqlite_master` 에서 DDL 과 인덱스를 **읽어서 생성**했다.
-- 바뀐 것은 두 컬럼에 `DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))` 이 붙은 것뿐이고, 나머지 DDL 은 원문
-- 그대로다. 생성 시 값: 표 32개, 다시 만드는 인덱스 52개.
--
-- ## 안전 장치 (0002 와 같은 방식, 더 넓게)
--
-- 1. `PRAGMA foreign_keys=OFF` 가 실제로 먹었는지 첫 DROP 전에 단언한다. FK 가
--    켜진 채 DROP 하면 자식 표가 cascade 로 비는데, 그때 행 수 단언은 "자기
--    DROP 직전" 에만 걸려 있어 **에러 없이** 지나간다(0002 실측).
-- 2. **재실행 차단**: 표마다 컬럼 수가 생성 시점과 같아야 한다. 뒤 마이그레이션이
--    컬럼을 더한 뒤 이 파일이 다시 돌면 재작성이 그 컬럼을 모르고 지우므로, 그
--    경우 CHECK 위반으로 전체가 롤백된다. 또 `posts.created_at` 에 이미 DEFAULT
--    가 있으면(= 이미 적용됨) 같은 방식으로 롤백된다.
-- 3. 표마다 복사 전후 행 수가 같아야 한다.
-- 4. 끝에서 FK 위반 0건, 재작성한 표들의 이름 있는 인덱스 수가 생성 시점(52개)과
--    같아야 한다(재작성이 인덱스를 떨어뜨린 0002 의 사고를 잡는다).
--
-- BEGIN/COMMIT 과 `executeMultiple()` 적용 경로는 0002·0013~0017 과 같다 —
-- `drizzle-kit migrate` 로 적용하지 마라(`scripts/turso/README.md`).
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
BEGIN;
--> statement-breakpoint
DROP TABLE IF EXISTS `__migration_assert_0019`;
--> statement-breakpoint
CREATE TABLE `__migration_assert_0019` (`ok` integer NOT NULL CHECK (`ok` = 1));
--> statement-breakpoint
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT foreign_keys FROM pragma_foreign_keys()) = 0 THEN 1 ELSE 0 END;
--> statement-breakpoint
-- 재실행 차단: posts.created_at 에 이미 DEFAULT 가 있으면 이 파일은 적용된 것이다.
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (
  SELECT count(*) FROM pragma_table_info('posts') WHERE `name` = 'created_at' AND `dflt_value` IS NULL
) = 1 THEN 1 ELSE 0 END;
-- account: 컬럼 13개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('account')) = 13 THEN 1 ELSE 0 END;
-- artists: 컬럼 20개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('artists')) = 20 THEN 1 ELSE 0 END;
-- billing_keys: 컬럼 11개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('billing_keys')) = 11 THEN 1 ELSE 0 END;
-- board_agenda_comments: 컬럼 7개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('board_agenda_comments')) = 7 THEN 1 ELSE 0 END;
-- board_agendas: 컬럼 9개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('board_agendas')) = 9 THEN 1 ELSE 0 END;
-- board_documents: 컬럼 9개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('board_documents')) = 9 THEN 1 ELSE 0 END;
-- board_meeting_attendees: 컬럼 6개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('board_meeting_attendees')) = 6 THEN 1 ELSE 0 END;
-- board_meeting_date_votes: 컬럼 6개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('board_meeting_date_votes')) = 6 THEN 1 ELSE 0 END;
-- board_meetings: 컬럼 10개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('board_meetings')) = 10 THEN 1 ELSE 0 END;
-- board_minutes: 컬럼 7개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('board_minutes')) = 7 THEN 1 ELSE 0 END;
-- comment_likes: 컬럼 4개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('comment_likes')) = 4 THEN 1 ELSE 0 END;
-- comments: 컬럼 7개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('comments')) = 7 THEN 1 ELSE 0 END;
-- default_settings: 컬럼 7개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('default_settings')) = 7 THEN 1 ELSE 0 END;
-- event_applications: 컬럼 16개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('event_applications')) = 16 THEN 1 ELSE 0 END;
-- grant_digests: 컬럼 7개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('grant_digests')) = 7 THEN 1 ELSE 0 END;
-- link_previews: 컬럼 6개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('link_previews')) = 6 THEN 1 ELSE 0 END;
-- member_bulk_operations: 컬럼 11개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('member_bulk_operations')) = 11 THEN 1 ELSE 0 END;
-- member_profiles: 컬럼 37개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('member_profiles')) = 37 THEN 1 ELSE 0 END;
-- membership_dues: 컬럼 9개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('membership_dues')) = 9 THEN 1 ELSE 0 END;
-- notifications: 컬럼 11개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('notifications')) = 11 THEN 1 ELSE 0 END;
-- payments: 컬럼 18개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('payments')) = 18 THEN 1 ELSE 0 END;
-- performance_shows: 컬럼 6개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('performance_shows')) = 6 THEN 1 ELSE 0 END;
-- performances: 컬럼 12개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('performances')) = 12 THEN 1 ELSE 0 END;
-- post_attachments: 컬럼 15개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('post_attachments')) = 15 THEN 1 ELSE 0 END;
-- post_likes: 컬럼 4개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('post_likes')) = 4 THEN 1 ELSE 0 END;
-- posts: 컬럼 13개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('posts')) = 13 THEN 1 ELSE 0 END;
-- reservations: 컬럼 17개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('reservations')) = 17 THEN 1 ELSE 0 END;
-- session: 컬럼 8개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('session')) = 8 THEN 1 ELSE 0 END;
-- system_settings: 컬럼 9개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('system_settings')) = 9 THEN 1 ELSE 0 END;
-- ticket_types: 컬럼 9개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('ticket_types')) = 9 THEN 1 ELSE 0 END;
-- user_activities: 컬럼 10개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('user_activities')) = 10 THEN 1 ELSE 0 END;
-- user_settings: 컬럼 7개 그대로여야 한다(뒤 마이그레이션이 컬럼을 더한 뒤 재실행되면 여기서 롤백).
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_table_info('user_settings')) = 7 THEN 1 ELSE 0 END;

-- ---- account (updated_at)
DROP TABLE IF EXISTS `__new_account`;
CREATE TABLE `__new_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_account`("id", "account_id", "provider_id", "user_id", "access_token", "refresh_token", "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope", "password", "created_at", "updated_at") SELECT "id", "account_id", "provider_id", "user_id", "access_token", "refresh_token", "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope", "password", "created_at", "updated_at" FROM `account`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_account`) = (SELECT count(*) FROM `account`) THEN 1 ELSE 0 END;
DROP TABLE `account`;
ALTER TABLE `__new_account` RENAME TO `account`;
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);

-- ---- artists (created_at, updated_at)
DROP TABLE IF EXISTS `__new_artists`;
CREATE TABLE `__new_artists` (
	`id` text PRIMARY KEY NOT NULL,
	`legacy_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`one_liner` text,
	`bio` text,
	`template_type` text DEFAULT '콜라주형',
	`portfolio_links` text DEFAULT '[]' NOT NULL,
	`youtube_videos` text DEFAULT '[]' NOT NULL,
	`contact` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`profile_photo_url` text,
	`profile_photo_metadata` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`name_en` text,
	`one_liner_en` text,
	`bio_en` text,
	`template_type_en` text
);
INSERT INTO `__new_artists`("id", "legacy_id", "slug", "name", "category", "one_liner", "bio", "template_type", "portfolio_links", "youtube_videos", "contact", "created_at", "updated_at", "profile_photo_url", "profile_photo_metadata", "is_active", "name_en", "one_liner_en", "bio_en", "template_type_en") SELECT "id", "legacy_id", "slug", "name", "category", "one_liner", "bio", "template_type", "portfolio_links", "youtube_videos", "contact", "created_at", "updated_at", "profile_photo_url", "profile_photo_metadata", "is_active", "name_en", "one_liner_en", "bio_en", "template_type_en" FROM `artists`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_artists`) = (SELECT count(*) FROM `artists`) THEN 1 ELSE 0 END;
DROP TABLE `artists`;
ALTER TABLE `__new_artists` RENAME TO `artists`;
CREATE UNIQUE INDEX `artists_legacy_id_unique` ON `artists` (`legacy_id`);
CREATE UNIQUE INDEX `artists_slug_unique` ON `artists` (`slug`);

-- ---- billing_keys (created_at, updated_at)
DROP TABLE IF EXISTS `__new_billing_keys`;
CREATE TABLE `__new_billing_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`billing_key` text NOT NULL,
	`customer_key` text NOT NULL,
	`card_issuer_code` text,
	`card_number_masked` text,
	`card_type` text,
	`is_active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_billing_keys`("id", "user_id", "billing_key", "customer_key", "card_issuer_code", "card_number_masked", "card_type", "is_active", "deactivated_at", "created_at", "updated_at") SELECT "id", "user_id", "billing_key", "customer_key", "card_issuer_code", "card_number_masked", "card_type", "is_active", "deactivated_at", "created_at", "updated_at" FROM `billing_keys`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_billing_keys`) = (SELECT count(*) FROM `billing_keys`) THEN 1 ELSE 0 END;
DROP TABLE `billing_keys`;
ALTER TABLE `__new_billing_keys` RENAME TO `billing_keys`;
CREATE UNIQUE INDEX `billing_keys_active_user_idx` ON `billing_keys` (`user_id`) WHERE "is_active" = 1;

-- ---- board_agenda_comments (created_at, updated_at)
DROP TABLE IF EXISTS `__new_board_agenda_comments`;
CREATE TABLE `__new_board_agenda_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`agenda_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`agenda_id`) REFERENCES `board_agendas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `__new_board_agenda_comments`("id", "agenda_id", "author_id", "content", "is_deleted", "created_at", "updated_at") SELECT "id", "agenda_id", "author_id", "content", "is_deleted", "created_at", "updated_at" FROM `board_agenda_comments`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_agenda_comments`) = (SELECT count(*) FROM `board_agenda_comments`) THEN 1 ELSE 0 END;
DROP TABLE `board_agenda_comments`;
ALTER TABLE `__new_board_agenda_comments` RENAME TO `board_agenda_comments`;
CREATE INDEX `board_agenda_comments_agenda_created_idx` ON `board_agenda_comments` (`agenda_id`,`created_at`);

-- ---- board_agendas (created_at, updated_at)
DROP TABLE IF EXISTS `__new_board_agendas`;
CREATE TABLE `__new_board_agendas` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`proposed_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `__new_board_agendas`("id", "meeting_id", "title", "content", "sort_order", "status", "proposed_by", "created_at", "updated_at") SELECT "id", "meeting_id", "title", "content", "sort_order", "status", "proposed_by", "created_at", "updated_at" FROM `board_agendas`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_agendas`) = (SELECT count(*) FROM `board_agendas`) THEN 1 ELSE 0 END;
DROP TABLE `board_agendas`;
ALTER TABLE `__new_board_agendas` RENAME TO `board_agendas`;
CREATE INDEX `idx_board_agendas_meeting` ON `board_agendas` (`meeting_id`, `sort_order`);

-- ---- board_documents (created_at)
DROP TABLE IF EXISTS `__new_board_documents`;
CREATE TABLE `__new_board_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text,
	`file_size` integer,
	`mime_type` text,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `__new_board_documents`("id", "title", "category", "file_path", "file_name", "file_size", "mime_type", "uploaded_by", "created_at") SELECT "id", "title", "category", "file_path", "file_name", "file_size", "mime_type", "uploaded_by", "created_at" FROM `board_documents`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_documents`) = (SELECT count(*) FROM `board_documents`) THEN 1 ELSE 0 END;
DROP TABLE `board_documents`;
ALTER TABLE `__new_board_documents` RENAME TO `board_documents`;
CREATE INDEX `idx_board_documents_category` ON `board_documents` (`category`, `created_at` DESC);

-- ---- board_meeting_attendees (created_at, updated_at)
DROP TABLE IF EXISTS `__new_board_meeting_attendees`;
CREATE TABLE `__new_board_meeting_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`member_id` text NOT NULL,
	`attended` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `__new_board_meeting_attendees`("id", "meeting_id", "member_id", "attended", "created_at", "updated_at") SELECT "id", "meeting_id", "member_id", "attended", "created_at", "updated_at" FROM `board_meeting_attendees`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_meeting_attendees`) = (SELECT count(*) FROM `board_meeting_attendees`) THEN 1 ELSE 0 END;
DROP TABLE `board_meeting_attendees`;
ALTER TABLE `__new_board_meeting_attendees` RENAME TO `board_meeting_attendees`;
CREATE UNIQUE INDEX `board_meeting_attendees_meeting_member_idx` ON `board_meeting_attendees` (`meeting_id`,`member_id`);

-- ---- board_meeting_date_votes (created_at, updated_at)
DROP TABLE IF EXISTS `__new_board_meeting_date_votes`;
CREATE TABLE `__new_board_meeting_date_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`option_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`is_available` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`option_id`) REFERENCES `board_meeting_date_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voter_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `__new_board_meeting_date_votes`("id", "option_id", "voter_id", "is_available", "created_at", "updated_at") SELECT "id", "option_id", "voter_id", "is_available", "created_at", "updated_at" FROM `board_meeting_date_votes`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_meeting_date_votes`) = (SELECT count(*) FROM `board_meeting_date_votes`) THEN 1 ELSE 0 END;
DROP TABLE `board_meeting_date_votes`;
ALTER TABLE `__new_board_meeting_date_votes` RENAME TO `board_meeting_date_votes`;
CREATE UNIQUE INDEX `board_meeting_date_votes_option_voter_idx` ON `board_meeting_date_votes` (`option_id`,`voter_id`);

-- ---- board_meetings (created_at, updated_at)
DROP TABLE IF EXISTS `__new_board_meetings`;
CREATE TABLE `__new_board_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`meeting_date` text,
	`location` text,
	`status` text DEFAULT 'polling' NOT NULL,
	`vote_deadline` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `meeting_time` text,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `__new_board_meetings`("id", "title", "meeting_date", "location", "status", "vote_deadline", "created_by", "created_at", "updated_at", "meeting_time") SELECT "id", "title", "meeting_date", "location", "status", "vote_deadline", "created_by", "created_at", "updated_at", "meeting_time" FROM `board_meetings`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_meetings`) = (SELECT count(*) FROM `board_meetings`) THEN 1 ELSE 0 END;
DROP TABLE `board_meetings`;
ALTER TABLE `__new_board_meetings` RENAME TO `board_meetings`;
CREATE INDEX `idx_board_meetings_created_at` ON `board_meetings` (`created_at`);

-- ---- board_minutes (created_at, updated_at)
DROP TABLE IF EXISTS `__new_board_minutes`;
CREATE TABLE `__new_board_minutes` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`content` text,
	`content_format` text,
	`author_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `__new_board_minutes`("id", "meeting_id", "content", "content_format", "author_id", "created_at", "updated_at") SELECT "id", "meeting_id", "content", "content_format", "author_id", "created_at", "updated_at" FROM `board_minutes`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_board_minutes`) = (SELECT count(*) FROM `board_minutes`) THEN 1 ELSE 0 END;
DROP TABLE `board_minutes`;
ALTER TABLE `__new_board_minutes` RENAME TO `board_minutes`;
CREATE UNIQUE INDEX `board_minutes_meeting_id_idx` ON `board_minutes` (`meeting_id`);

-- ---- comment_likes (created_at)
DROP TABLE IF EXISTS `__new_comment_likes`;
CREATE TABLE `__new_comment_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_comment_likes`("id", "comment_id", "user_id", "created_at") SELECT "id", "comment_id", "user_id", "created_at" FROM `comment_likes`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_comment_likes`) = (SELECT count(*) FROM `comment_likes`) THEN 1 ELSE 0 END;
DROP TABLE `comment_likes`;
ALTER TABLE `__new_comment_likes` RENAME TO `comment_likes`;
CREATE UNIQUE INDEX `comment_likes_comment_user_idx` ON `comment_likes` (`comment_id`,`user_id`);
CREATE INDEX `idx_comment_likes_user_comment` ON `comment_likes` (`user_id`, `comment_id`);

-- ---- comments (created_at, updated_at)
DROP TABLE IF EXISTS `__new_comments`;
CREATE TABLE `__new_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `__new_comments`("id", "post_id", "author_id", "content", "created_at", "updated_at", "like_count") SELECT "id", "post_id", "author_id", "content", "created_at", "updated_at", "like_count" FROM `comments`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_comments`) = (SELECT count(*) FROM `comments`) THEN 1 ELSE 0 END;
DROP TABLE `comments`;
ALTER TABLE `__new_comments` RENAME TO `comments`;
CREATE INDEX `idx_comments_author_id` ON `comments` (`author_id`, `created_at` DESC);
CREATE INDEX `idx_comments_post_id_created_at` ON `comments` (`post_id`, `created_at`, `id`);

-- ---- default_settings (created_at)
DROP TABLE IF EXISTS `__new_default_settings`;
CREATE TABLE `__new_default_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`setting_key` text NOT NULL,
	`default_value` text DEFAULT '{}' NOT NULL,
	`description` text,
	`is_required` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
INSERT INTO `__new_default_settings`("id", "category", "setting_key", "default_value", "description", "is_required", "created_at") SELECT "id", "category", "setting_key", "default_value", "description", "is_required", "created_at" FROM `default_settings`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_default_settings`) = (SELECT count(*) FROM `default_settings`) THEN 1 ELSE 0 END;
DROP TABLE `default_settings`;
ALTER TABLE `__new_default_settings` RENAME TO `default_settings`;
CREATE UNIQUE INDEX `default_settings_category_key_idx` ON `default_settings` (`category`,`setting_key`);

-- ---- event_applications (created_at, updated_at)
DROP TABLE IF EXISTS `__new_event_applications`;
CREATE TABLE `__new_event_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`event_slug` text NOT NULL,
	`applicant_name` text NOT NULL,
	`contact_email` text,
	`contact_phone` text,
	`performance_info` text,
	`items_to_sell` text,
	`links` text,
	`message` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`privacy_consent` integer DEFAULT false NOT NULL,
	`privacy_consent_at` integer,
	`participation_type` text,
	`photo_url` text
);
INSERT INTO `__new_event_applications`("id", "event_slug", "applicant_name", "contact_email", "contact_phone", "performance_info", "items_to_sell", "links", "message", "status", "created_at", "updated_at", "privacy_consent", "privacy_consent_at", "participation_type", "photo_url") SELECT "id", "event_slug", "applicant_name", "contact_email", "contact_phone", "performance_info", "items_to_sell", "links", "message", "status", "created_at", "updated_at", "privacy_consent", "privacy_consent_at", "participation_type", "photo_url" FROM `event_applications`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_event_applications`) = (SELECT count(*) FROM `event_applications`) THEN 1 ELSE 0 END;
DROP TABLE `event_applications`;
ALTER TABLE `__new_event_applications` RENAME TO `event_applications`;
CREATE UNIQUE INDEX `event_applications_slug_phone_idx` ON `event_applications` (`event_slug`,`contact_phone`);

-- ---- grant_digests (created_at)
DROP TABLE IF EXISTS `__new_grant_digests`;
CREATE TABLE `__new_grant_digests` (
	`id` text PRIMARY KEY NOT NULL,
	`week_key` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`post_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`published_at` integer
);
INSERT INTO `__new_grant_digests`("id", "week_key", "items", "status", "post_id", "created_at", "published_at") SELECT "id", "week_key", "items", "status", "post_id", "created_at", "published_at" FROM `grant_digests`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_grant_digests`) = (SELECT count(*) FROM `grant_digests`) THEN 1 ELSE 0 END;
DROP TABLE `grant_digests`;
ALTER TABLE `__new_grant_digests` RENAME TO `grant_digests`;
CREATE UNIQUE INDEX `grant_digests_week_key_idx` ON `grant_digests` (`week_key`);

-- ---- link_previews (created_at, updated_at)
DROP TABLE IF EXISTS `__new_link_previews`;
CREATE TABLE `__new_link_previews` (
	`url` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`last_fetched` integer NOT NULL,
	`ttl_seconds` integer DEFAULT 21600 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
INSERT INTO `__new_link_previews`("url", "data", "last_fetched", "ttl_seconds", "created_at", "updated_at") SELECT "url", "data", "last_fetched", "ttl_seconds", "created_at", "updated_at" FROM `link_previews`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_link_previews`) = (SELECT count(*) FROM `link_previews`) THEN 1 ELSE 0 END;
DROP TABLE `link_previews`;
ALTER TABLE `__new_link_previews` RENAME TO `link_previews`;

-- ---- member_bulk_operations (created_at)
DROP TABLE IF EXISTS `__new_member_bulk_operations`;
CREATE TABLE `__new_member_bulk_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_type` text NOT NULL,
	`performed_by` text NOT NULL,
	`member_ids` text NOT NULL,
	`parameters` text DEFAULT '{}' NOT NULL,
	`results` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`error_message` text,
	FOREIGN KEY (`performed_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `__new_member_bulk_operations`("id", "operation_type", "performed_by", "member_ids", "parameters", "results", "status", "created_at", "started_at", "completed_at", "error_message") SELECT "id", "operation_type", "performed_by", "member_ids", "parameters", "results", "status", "created_at", "started_at", "completed_at", "error_message" FROM `member_bulk_operations`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_member_bulk_operations`) = (SELECT count(*) FROM `member_bulk_operations`) THEN 1 ELSE 0 END;
DROP TABLE `member_bulk_operations`;
ALTER TABLE `__new_member_bulk_operations` RENAME TO `member_bulk_operations`;

-- ---- member_profiles (created_at, updated_at)
DROP TABLE IF EXISTS `__new_member_profiles`;
CREATE TABLE `__new_member_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`phone_number` text,
	`birth_date` text,
	`real_name` text,
	`monthly_fee` integer,
	`bank_name` text,
	`account_number` text,
	`account_holder` text,
	`registration_status` text DEFAULT 'pending' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`approved_at` integer,
	`approved_by` text,
	`last_login_at` integer,
	`rejected_by` text,
	`suspension_reason` text,
	`suspension_until` integer,
	`is_suspended` integer DEFAULT false NOT NULL,
	`profile_completeness_score` integer DEFAULT 0 NOT NULL,
	`verification_status` text DEFAULT '{"email":false,"phone":false,"identity":false}' NOT NULL,
	`membership_type` text DEFAULT 'regular' NOT NULL,
	`engagement_score` integer DEFAULT 0 NOT NULL,
	`is_member` integer DEFAULT true NOT NULL,
	`artist_id` text,
	`is_artist` integer DEFAULT false NOT NULL,
	`artist_role` text DEFAULT 'owner' NOT NULL,
	`is_director` integer DEFAULT false NOT NULL,
	`director_title` text,
	`is_auditor` integer DEFAULT false NOT NULL
, `withdrawn_at` integer, `withdrawal_requested_at` integer, `interest_genres` text DEFAULT '[]' NOT NULL, `interest_regions` text DEFAULT '[]' NOT NULL);
INSERT INTO `__new_member_profiles`("id", "display_name", "email", "phone_number", "birth_date", "real_name", "monthly_fee", "bank_name", "account_number", "account_holder", "registration_status", "is_active", "is_admin", "created_at", "updated_at", "approved_at", "approved_by", "last_login_at", "rejected_by", "suspension_reason", "suspension_until", "is_suspended", "profile_completeness_score", "verification_status", "membership_type", "engagement_score", "is_member", "artist_id", "is_artist", "artist_role", "is_director", "director_title", "is_auditor", "withdrawn_at", "withdrawal_requested_at", "interest_genres", "interest_regions") SELECT "id", "display_name", "email", "phone_number", "birth_date", "real_name", "monthly_fee", "bank_name", "account_number", "account_holder", "registration_status", "is_active", "is_admin", "created_at", "updated_at", "approved_at", "approved_by", "last_login_at", "rejected_by", "suspension_reason", "suspension_until", "is_suspended", "profile_completeness_score", "verification_status", "membership_type", "engagement_score", "is_member", "artist_id", "is_artist", "artist_role", "is_director", "director_title", "is_auditor", "withdrawn_at", "withdrawal_requested_at", "interest_genres", "interest_regions" FROM `member_profiles`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_member_profiles`) = (SELECT count(*) FROM `member_profiles`) THEN 1 ELSE 0 END;
DROP TABLE `member_profiles`;
ALTER TABLE `__new_member_profiles` RENAME TO `member_profiles`;
CREATE INDEX `idx_member_profiles_artist_id` ON `member_profiles` (`artist_id`);
CREATE INDEX `idx_member_profiles_created_at` ON `member_profiles` (`created_at` DESC);
CREATE INDEX `idx_member_profiles_status` ON `member_profiles` (`registration_status`, `created_at` DESC);
CREATE UNIQUE INDEX `member_profiles_email_idx` ON `member_profiles` (`email`);

-- ---- membership_dues (created_at, updated_at)
DROP TABLE IF EXISTS `__new_membership_dues`;
CREATE TABLE `__new_membership_dues` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`billing_month` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`payment_id` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `__new_membership_dues`("id", "user_id", "billing_month", "amount", "status", "payment_id", "paid_at", "created_at", "updated_at") SELECT "id", "user_id", "billing_month", "amount", "status", "payment_id", "paid_at", "created_at", "updated_at" FROM `membership_dues`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_membership_dues`) = (SELECT count(*) FROM `membership_dues`) THEN 1 ELSE 0 END;
DROP TABLE `membership_dues`;
ALTER TABLE `__new_membership_dues` RENAME TO `membership_dues`;
CREATE INDEX `idx_membership_dues_month_status` ON `membership_dues` (`billing_month`, `status`);
CREATE UNIQUE INDEX `membership_dues_user_month_idx` ON `membership_dues` (`user_id`,`billing_month`);

-- ---- notifications (created_at)
DROP TABLE IF EXISTS `__new_notifications`;
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	`related_post_id` text,
	`related_user_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_notifications`("id", "user_id", "type", "title", "message", "data", "read_at", "created_at", "expires_at", "related_post_id", "related_user_id") SELECT "id", "user_id", "type", "title", "message", "data", "read_at", "created_at", "expires_at", "related_post_id", "related_user_id" FROM `notifications`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_notifications`) = (SELECT count(*) FROM `notifications`) THEN 1 ELSE 0 END;
DROP TABLE `notifications`;
ALTER TABLE `__new_notifications` RENAME TO `notifications`;
CREATE INDEX `idx_notifications_read_status` ON `notifications` (`user_id`, `read_at`);
CREATE INDEX `idx_notifications_user_created_at` ON `notifications` (`user_id`, `created_at` DESC);

-- ---- payments (created_at, updated_at)
DROP TABLE IF EXISTS `__new_payments`;
CREATE TABLE `__new_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`order_name` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_key` text,
	`method` text,
	`approved_at` integer,
	`canceled_amount` integer DEFAULT 0 NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`raw_response` text,
	`payer_name` text,
	`payer_email` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `__new_payments`("id", "order_id", "user_id", "kind", "order_name", "amount", "status", "payment_key", "method", "approved_at", "canceled_amount", "failure_code", "failure_message", "raw_response", "payer_name", "payer_email", "created_at", "updated_at") SELECT "id", "order_id", "user_id", "kind", "order_name", "amount", "status", "payment_key", "method", "approved_at", "canceled_amount", "failure_code", "failure_message", "raw_response", "payer_name", "payer_email", "created_at", "updated_at" FROM `payments`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_payments`) = (SELECT count(*) FROM `payments`) THEN 1 ELSE 0 END;
DROP TABLE `payments`;
ALTER TABLE `__new_payments` RENAME TO `payments`;
CREATE INDEX `idx_payments_user_created` ON `payments` (`user_id`, `created_at`);
CREATE UNIQUE INDEX `payments_order_id_unique` ON `payments` (`order_id`);

-- ---- performance_shows (created_at, updated_at)
DROP TABLE IF EXISTS `__new_performance_shows`;
CREATE TABLE `__new_performance_shows` (
	`id` text PRIMARY KEY NOT NULL,
	`performance_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`capacity` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`performance_id`) REFERENCES `performances`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_performance_shows`("id", "performance_id", "starts_at", "capacity", "created_at", "updated_at") SELECT "id", "performance_id", "starts_at", "capacity", "created_at", "updated_at" FROM `performance_shows`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_performance_shows`) = (SELECT count(*) FROM `performance_shows`) THEN 1 ELSE 0 END;
DROP TABLE `performance_shows`;
ALTER TABLE `__new_performance_shows` RENAME TO `performance_shows`;
CREATE INDEX `performance_shows_performance_idx` ON `performance_shows` (`performance_id`,`starts_at`);

-- ---- performances (created_at, updated_at)
DROP TABLE IF EXISTS `__new_performances`;
CREATE TABLE `__new_performances` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`description` text,
	`venue` text,
	`poster_image` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`notice_text` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `__new_performances`("id", "slug", "title", "summary", "description", "venue", "poster_image", "status", "notice_text", "created_by", "created_at", "updated_at") SELECT "id", "slug", "title", "summary", "description", "venue", "poster_image", "status", "notice_text", "created_by", "created_at", "updated_at" FROM `performances`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_performances`) = (SELECT count(*) FROM `performances`) THEN 1 ELSE 0 END;
DROP TABLE `performances`;
ALTER TABLE `__new_performances` RENAME TO `performances`;
CREATE UNIQUE INDEX `performances_slug_unique` ON `performances` (`slug`);
CREATE INDEX `performances_status_idx` ON `performances` (`status`);

-- ---- post_attachments (created_at, updated_at)
DROP TABLE IF EXISTS `__new_post_attachments`;
CREATE TABLE `__new_post_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_url` text NOT NULL,
	`file_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`alt_text` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`is_temporary` integer DEFAULT false NOT NULL,
	`temp_session` text,
	`expires_at` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_post_attachments`("id", "post_id", "file_name", "file_url", "file_type", "file_size", "mime_type", "alt_text", "is_primary", "sort_order", "created_at", "updated_at", "is_temporary", "temp_session", "expires_at") SELECT "id", "post_id", "file_name", "file_url", "file_type", "file_size", "mime_type", "alt_text", "is_primary", "sort_order", "created_at", "updated_at", "is_temporary", "temp_session", "expires_at" FROM `post_attachments`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_post_attachments`) = (SELECT count(*) FROM `post_attachments`) THEN 1 ELSE 0 END;
DROP TABLE `post_attachments`;
ALTER TABLE `__new_post_attachments` RENAME TO `post_attachments`;
CREATE INDEX `idx_post_attachments_post_sort` ON `post_attachments` (`post_id`, `sort_order`);
CREATE INDEX `idx_post_attachments_temp_cleanup` ON `post_attachments` (`is_temporary`, `expires_at`);
CREATE UNIQUE INDEX `post_attachments_primary_idx` ON `post_attachments` (`post_id`) WHERE `is_primary` = 1;

-- ---- post_likes (created_at)
DROP TABLE IF EXISTS `__new_post_likes`;
CREATE TABLE `__new_post_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_post_likes`("id", "post_id", "user_id", "created_at") SELECT "id", "post_id", "user_id", "created_at" FROM `post_likes`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_post_likes`) = (SELECT count(*) FROM `post_likes`) THEN 1 ELSE 0 END;
DROP TABLE `post_likes`;
ALTER TABLE `__new_post_likes` RENAME TO `post_likes`;
CREATE INDEX `idx_post_likes_user_post` ON `post_likes` (`user_id`, `post_id`);
CREATE UNIQUE INDEX `post_likes_post_user_idx` ON `post_likes` (`post_id`,`user_id`);

-- ---- posts (created_at, updated_at)
DROP TABLE IF EXISTS `__new_posts`;
CREATE TABLE `__new_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`category` text DEFAULT '잡담' NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`pinned_at` integer,
	`content_format` text DEFAULT 'plain' NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `__new_posts`("id", "title", "content", "category", "author_id", "created_at", "updated_at", "is_deleted", "is_pinned", "pinned_at", "content_format", "like_count", "view_count") SELECT "id", "title", "content", "category", "author_id", "created_at", "updated_at", "is_deleted", "is_pinned", "pinned_at", "content_format", "like_count", "view_count" FROM `posts`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_posts`) = (SELECT count(*) FROM `posts`) THEN 1 ELSE 0 END;
DROP TABLE `posts`;
ALTER TABLE `__new_posts` RENAME TO `posts`;
CREATE INDEX `idx_posts_author_id` ON `posts` (`author_id`, `is_deleted`, `created_at` DESC);
CREATE INDEX `idx_posts_category_keyset_pagination` ON `posts` (`is_deleted`, `category`, `is_pinned` DESC, `created_at` DESC, `id` DESC);
CREATE INDEX `idx_posts_created_at_not_deleted` ON `posts` (`is_deleted`, `created_at` DESC);
CREATE INDEX `idx_posts_keyset_pagination` ON `posts` (`is_deleted`, `is_pinned` DESC, `created_at` DESC, `id` DESC);

-- ---- reservations (created_at, updated_at)
DROP TABLE IF EXISTS `__new_reservations`;
CREATE TABLE `__new_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_code` text NOT NULL,
	`show_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	`user_id` text,
	`booker_name` text NOT NULL,
	`booker_phone` text NOT NULL,
	`booker_email` text,
	`quantity` integer NOT NULL,
	`total_amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_id` text,
	`hold_expires_at` integer,
	`canceled_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `order_id` text,
	FOREIGN KEY (`show_id`) REFERENCES `performance_shows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `__new_reservations`("id", "reservation_code", "show_id", "ticket_type_id", "user_id", "booker_name", "booker_phone", "booker_email", "quantity", "total_amount", "status", "payment_id", "hold_expires_at", "canceled_at", "created_at", "updated_at", "order_id") SELECT "id", "reservation_code", "show_id", "ticket_type_id", "user_id", "booker_name", "booker_phone", "booker_email", "quantity", "total_amount", "status", "payment_id", "hold_expires_at", "canceled_at", "created_at", "updated_at", "order_id" FROM `reservations`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_reservations`) = (SELECT count(*) FROM `reservations`) THEN 1 ELSE 0 END;
DROP TABLE `reservations`;
ALTER TABLE `__new_reservations` RENAME TO `reservations`;
CREATE UNIQUE INDEX `reservations_order_id_idx` ON `reservations` (`order_id`);
CREATE UNIQUE INDEX `reservations_reservation_code_unique` ON `reservations` (`reservation_code`);
CREATE INDEX `reservations_show_status_idx` ON `reservations` (`show_id`,`status`);
CREATE INDEX `reservations_status_hold_idx` ON `reservations` (`status`, `hold_expires_at`);
CREATE INDEX `reservations_user_idx` ON `reservations` (`user_id`);

-- ---- session (updated_at)
DROP TABLE IF EXISTS `__new_session`;
CREATE TABLE `__new_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_session`("id", "expires_at", "token", "created_at", "updated_at", "ip_address", "user_agent", "user_id") SELECT "id", "expires_at", "token", "created_at", "updated_at", "ip_address", "user_agent", "user_id" FROM `session`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_session`) = (SELECT count(*) FROM `session`) THEN 1 ELSE 0 END;
DROP TABLE `session`;
ALTER TABLE `__new_session` RENAME TO `session`;
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);

-- ---- system_settings (created_at, updated_at)
DROP TABLE IF EXISTS `__new_system_settings`;
CREATE TABLE `__new_system_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text DEFAULT '{}' NOT NULL,
	`description` text,
	`is_sensitive` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `__new_system_settings`("id", "category", "setting_key", "setting_value", "description", "is_sensitive", "created_at", "updated_at", "updated_by") SELECT "id", "category", "setting_key", "setting_value", "description", "is_sensitive", "created_at", "updated_at", "updated_by" FROM `system_settings`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_system_settings`) = (SELECT count(*) FROM `system_settings`) THEN 1 ELSE 0 END;
DROP TABLE `system_settings`;
ALTER TABLE `__new_system_settings` RENAME TO `system_settings`;
CREATE UNIQUE INDEX `system_settings_category_key_idx` ON `system_settings` (`category`,`setting_key`);

-- ---- ticket_types (created_at, updated_at)
DROP TABLE IF EXISTS `__new_ticket_types`;
CREATE TABLE `__new_ticket_types` (
	`id` text PRIMARY KEY NOT NULL,
	`performance_id` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`max_per_order` integer DEFAULT 4 NOT NULL,
	`members_only` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`performance_id`) REFERENCES `performances`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_ticket_types`("id", "performance_id", "name", "price", "max_per_order", "members_only", "sort_order", "created_at", "updated_at") SELECT "id", "performance_id", "name", "price", "max_per_order", "members_only", "sort_order", "created_at", "updated_at" FROM `ticket_types`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_ticket_types`) = (SELECT count(*) FROM `ticket_types`) THEN 1 ELSE 0 END;
DROP TABLE `ticket_types`;
ALTER TABLE `__new_ticket_types` RENAME TO `ticket_types`;
CREATE INDEX `ticket_types_performance_idx` ON `ticket_types` (`performance_id`,`sort_order`);

-- ---- user_activities (created_at)
DROP TABLE IF EXISTS `__new_user_activities`;
CREATE TABLE `__new_user_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action_type` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`session_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO `__new_user_activities`("id", "user_id", "action_type", "target_type", "target_id", "metadata", "ip_address", "user_agent", "session_id", "created_at") SELECT "id", "user_id", "action_type", "target_type", "target_id", "metadata", "ip_address", "user_agent", "session_id", "created_at" FROM `user_activities`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_user_activities`) = (SELECT count(*) FROM `user_activities`) THEN 1 ELSE 0 END;
DROP TABLE `user_activities`;
ALTER TABLE `__new_user_activities` RENAME TO `user_activities`;
CREATE INDEX `idx_user_activities_composite` ON `user_activities` (`user_id`, `action_type`, `created_at` DESC);
CREATE INDEX `idx_user_activities_created_at` ON `user_activities` (`created_at` DESC);

-- ---- user_settings (created_at, updated_at)
DROP TABLE IF EXISTS `__new_user_settings`;
CREATE TABLE `__new_user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `__new_user_settings`("id", "user_id", "category", "setting_key", "setting_value", "created_at", "updated_at") SELECT "id", "user_id", "category", "setting_key", "setting_value", "created_at", "updated_at" FROM `user_settings`;
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM `__new_user_settings`) = (SELECT count(*) FROM `user_settings`) THEN 1 ELSE 0 END;
DROP TABLE `user_settings`;
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;
CREATE UNIQUE INDEX `user_settings_user_category_key_idx` ON `user_settings` (`user_id`,`category`,`setting_key`);
-- 마무리 단언
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (SELECT count(*) FROM pragma_foreign_key_check()) = 0 THEN 1 ELSE 0 END;
-- 재작성한 표들의 이름 있는 인덱스가 생성 시점과 같은 수여야 한다. DB 전체를
-- 세지 않는다 — 뒤 마이그레이션(0018 등)이 다른 표에 인덱스를 더하면 전체 수는
-- 정당하게 달라진다.
INSERT INTO `__migration_assert_0019` (`ok`) SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
    AND tbl_name IN ('account', 'artists', 'billing_keys', 'board_agenda_comments', 'board_agendas', 'board_documents', 'board_meeting_attendees', 'board_meeting_date_votes', 'board_meetings', 'board_minutes', 'comment_likes', 'comments', 'default_settings', 'event_applications', 'grant_digests', 'link_previews', 'member_bulk_operations', 'member_profiles', 'membership_dues', 'notifications', 'payments', 'performance_shows', 'performances', 'post_attachments', 'post_likes', 'posts', 'reservations', 'session', 'system_settings', 'ticket_types', 'user_activities', 'user_settings')
) = 52 THEN 1 ELSE 0 END;
DROP TABLE `__migration_assert_0019`;
COMMIT;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
