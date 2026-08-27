CREATE TABLE `billing_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`billing_key` text NOT NULL,
	`customer_key` text NOT NULL,
	`card_issuer_code` text,
	`card_number_masked` text,
	`card_type` text,
	`is_active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_keys_active_user_idx` ON `billing_keys` (`user_id`) WHERE "is_active" = 1;