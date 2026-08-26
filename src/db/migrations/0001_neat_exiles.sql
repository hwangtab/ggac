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