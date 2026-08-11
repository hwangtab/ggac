CREATE TABLE `artists` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`profile_photo_url` text,
	`profile_photo_metadata` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`name_en` text,
	`one_liner_en` text,
	`bio_en` text,
	`template_type_en` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artists_legacy_id_unique` ON `artists` (`legacy_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `artists_slug_unique` ON `artists` (`slug`);--> statement-breakpoint
CREATE TABLE `member_profiles` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_profiles_email_idx` ON `member_profiles` (`email`);--> statement-breakpoint
CREATE TABLE `comment_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_likes_comment_user_idx` ON `comment_likes` (`comment_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`related_post_id` text,
	`related_user_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `post_attachments` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_temporary` integer DEFAULT false NOT NULL,
	`temp_session` text,
	`expires_at` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `post_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_likes_post_user_idx` ON `post_likes` (`post_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`category` text DEFAULT '잡담' NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`pinned_at` integer,
	`content_format` text DEFAULT 'plain' NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `board_agendas` (
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
	FOREIGN KEY (`proposed_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `board_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text,
	`file_size` integer,
	`mime_type` text,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `board_meeting_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`member_id` text NOT NULL,
	`attended` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_meeting_attendees_meeting_member_idx` ON `board_meeting_attendees` (`meeting_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `board_meeting_date_options` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`candidate_date` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `board_meeting_date_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`option_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`is_available` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`option_id`) REFERENCES `board_meeting_date_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voter_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_meeting_date_votes_option_voter_idx` ON `board_meeting_date_votes` (`option_id`,`voter_id`);--> statement-breakpoint
CREATE TABLE `board_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`meeting_date` text,
	`location` text,
	`status` text DEFAULT 'polling' NOT NULL,
	`vote_deadline` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `board_minutes` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`content` text,
	`content_format` text,
	`author_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `default_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`setting_key` text NOT NULL,
	`default_value` text DEFAULT '{}' NOT NULL,
	`description` text,
	`is_required` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `default_settings_category_key_idx` ON `default_settings` (`category`,`setting_key`);--> statement-breakpoint
CREATE TABLE `event_applications` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`privacy_consent` integer DEFAULT false NOT NULL,
	`privacy_consent_at` integer,
	`participation_type` text,
	`photo_url` text
);
--> statement-breakpoint
CREATE TABLE `link_previews` (
	`url` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`last_fetched` integer NOT NULL,
	`ttl_seconds` integer DEFAULT 21600 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member_bulk_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_type` text NOT NULL,
	`performed_by` text NOT NULL,
	`member_ids` text NOT NULL,
	`parameters` text DEFAULT '{}' NOT NULL,
	`results` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`error_message` text,
	FOREIGN KEY (`performed_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text DEFAULT '{}' NOT NULL,
	`description` text,
	`is_sensitive` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `system_settings_category_key_idx` ON `system_settings` (`category`,`setting_key`);--> statement-breakpoint
CREATE TABLE `user_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action_type` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`session_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_category_key_idx` ON `user_settings` (`user_id`,`category`,`setting_key`);--> statement-breakpoint
CREATE TABLE `account` (
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
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);