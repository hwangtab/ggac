-- ⚠ **적용은 파일을 통째로 실행하는 경로로만 한다**(`executeMultiple`).
-- `drizzle-kit migrate`는 쓰지 않는다 — 이 저장소의 규약이고, 마이그레이터가
-- 자체 트랜잭션으로 감싸면 아래 `BEGIN`이 즉시 실패한다.
--
-- **왜 BEGIN/COMMIT이 붙었나.** `executeMultiple()`은 **문마다 자동 커밋**하므로
-- 트랜잭션이 없으면 중간 실패가 앞 문들을 그대로 남긴다. 그 반쪽 상태는
-- 재실행으로 복구되지 않는다(다음 실행이 "이미 있다"로 죽는다). 초기 구축이
-- 절반만 된 DB는 특히 알아채기 어렵다 — 앱이 뜨다가 없는 표에서 죽는다.
BEGIN;
--> statement-breakpoint
CREATE TABLE `daily_activity_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_date` text NOT NULL,
	`user_id` text,
	`action_type` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_updated` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_activity_stats_date_user_action_idx` ON `daily_activity_stats` (`activity_date`,`user_id`,`action_type`);--> statement-breakpoint
CREATE TABLE `system_settings_history` (
	`id` text PRIMARY KEY NOT NULL,
	`setting_id` text,
	`category` text NOT NULL,
	`setting_key` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_by` text,
	`changed_at` integer NOT NULL,
	`change_reason` text,
	FOREIGN KEY (`setting_id`) REFERENCES `system_settings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`session_token` text NOT NULL,
	`last_activity` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`login_at` integer NOT NULL,
	`logout_at` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_sessions_session_token_unique` ON `user_sessions` (`session_token`);
--> statement-breakpoint
COMMIT;
