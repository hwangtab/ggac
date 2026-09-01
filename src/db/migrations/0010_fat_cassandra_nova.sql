CREATE TABLE `grant_digests` (
	`id` text PRIMARY KEY NOT NULL,
	`week_key` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`post_id` text,
	`created_at` integer NOT NULL,
	`published_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grant_digests_week_key_idx` ON `grant_digests` (`week_key`);