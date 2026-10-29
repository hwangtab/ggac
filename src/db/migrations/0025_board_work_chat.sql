-- 이사회 업무툴 1단계 — 채팅(kosmart-work 이식). 설계: docs/board-work/01-설계.md §4·§5·§6.
--
-- 원본은 kosmart-work Postgres `work.*` 스키마다. 옮기면서:
-- - 표 이름에 `work_` 접두사(ggac 표와 겹치지 않게), 사람 FK는 `member_profiles`.
-- - enum·CHECK는 두지 않는다 — 허용값·길이는 각 영역의 zod 스키마가 정본이다(0022·0024와 같다).
-- - 원본의 RLS·BEFORE/AFTER 트리거는 **옮기지 않았다.** 작성자 강제·특권 열 동결·답글 수·링크 추출은
--   `src/db/queries/work/*` 쓰기 함수가 같은 트랜잭션에서 지킨다. 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
-- - 실시간 브로드캐스트 대신 `rev`·`pins_rev`·`tabs_rev`·`membership_rev` — 폴링 커서(§6).
-- - 접속(`work_presence`)·입력 중(`work_typing`)은 원본 Realtime Presence·broadcast 자리다.
--
-- DDL은 `src/db/schema/work.ts`를 drizzle-kit push로 빈 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- created_at·updated_at DEFAULT와 BEGIN/COMMIT은 0018과 같은 이유다. 인덱스 이름은 표 이름 접두사다.
BEGIN;

CREATE TABLE `work_member_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`quiet_enabled` integer DEFAULT false NOT NULL,
	`quiet_start` integer DEFAULT 1320 NOT NULL,
	`quiet_end` integer DEFAULT 480 NOT NULL,
	`quiet_weekends` integer DEFAULT true NOT NULL,
	`digest_mode` text DEFAULT 'normal' NOT NULL,
	`onboarded_at` integer,
	`channel_sort` text DEFAULT 'section' NOT NULL,
	`chat_sort` text DEFAULT 'recent' NOT NULL,
	`status_emoji` text,
	`status_text` text,
	`status_until` integer,
	`membership_rev` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `work_channel_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `work_channel_categories_name_key` ON `work_channel_categories` (lower(trim("name")));
CREATE INDEX `work_channel_categories_position_idx` ON `work_channel_categories` (`position`,`created_at`);

CREATE TABLE `work_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'public' NOT NULL,
	`slug` text,
	`name` text NOT NULL,
	`topic` text,
	`created_by` text,
	`dm_key` text,
	`is_group` integer DEFAULT false NOT NULL,
	`title` text,
	`post_policy` text DEFAULT 'everyone' NOT NULL,
	`category_id` text,
	`archived_at` integer,
	`rev` integer DEFAULT 0 NOT NULL,
	`pins_rev` integer DEFAULT 0 NOT NULL,
	`tabs_rev` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `work_channel_categories`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `work_channels_slug_key` ON `work_channels` (`slug`);
CREATE UNIQUE INDEX `work_channels_dm_key_key` ON `work_channels` (`dm_key`);
CREATE UNIQUE INDEX `work_channels_name_active_uidx` ON `work_channels` (lower(trim("name"))) WHERE "archived_at" is null and "kind" <> 'dm';
CREATE INDEX `work_channels_category_id_idx` ON `work_channels` (`category_id`);

CREATE TABLE `work_channel_members` (
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`last_read_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`notify_level` text,
	`joined_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`channel_id`, `user_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `work_channel_members_user_idx` ON `work_channel_members` (`user_id`);

CREATE TABLE `work_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`parent_id` text,
	`author_id` text,
	`kind` text DEFAULT 'text' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`attachments_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`last_reply_at` integer,
	`edited_at` integer,
	`deleted_at` integer,
	`sensitive` integer DEFAULT false NOT NULL,
	`quoted_message_id` text,
	`forwarded_from_id` text,
	`rev` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`quoted_message_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`forwarded_from_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `work_messages_channel_timeline_idx` ON `work_messages` (`channel_id`,"created_at" DESC,"id" DESC) WHERE "parent_id" is null;
CREATE INDEX `work_messages_thread_idx` ON `work_messages` (`parent_id`,`created_at`,`id`) WHERE "parent_id" is not null;
CREATE INDEX `work_messages_author_idx` ON `work_messages` (`author_id`);
CREATE INDEX `work_messages_channel_rev_idx` ON `work_messages` (`channel_id`,`rev`);
CREATE INDEX `work_messages_quoted_idx` ON `work_messages` (`quoted_message_id`) WHERE "quoted_message_id" is not null;
CREATE INDEX `work_messages_forwarded_idx` ON `work_messages` (`forwarded_from_id`) WHERE "forwarded_from_id" is not null;

CREATE TABLE `work_reactions` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`, `emoji`),
	FOREIGN KEY (`message_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `work_reactions_user_idx` ON `work_reactions` (`user_id`);

CREATE TABLE `work_mentions` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer,
	PRIMARY KEY(`message_id`, `user_id`),
	FOREIGN KEY (`message_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `work_mentions_unread_idx` ON `work_mentions` (`user_id`) WHERE "read_at" is null;

CREATE TABLE `work_bookmarks` (
	`user_id` text NOT NULL,
	`message_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `message_id`),
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `work_bookmarks_message_idx` ON `work_bookmarks` (`message_id`);

CREATE TABLE `work_pins` (
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`pinned_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`channel_id`, `message_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pinned_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `work_pins_message_idx` ON `work_pins` (`message_id`);

CREATE TABLE `work_message_links` (
	`message_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`message_id`, `url`),
	FOREIGN KEY (`message_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `work_message_links_channel_idx` ON `work_message_links` (`channel_id`,"created_at" DESC,`message_id`);

CREATE TABLE `work_activity_reads` (
	`user_id` text PRIMARY KEY NOT NULL,
	`seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `work_presence` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `work_typing` (
	`channel_id` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `scope`, `user_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

COMMIT;
