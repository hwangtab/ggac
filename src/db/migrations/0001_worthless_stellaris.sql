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
