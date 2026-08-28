CREATE TABLE `board_agenda_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`agenda_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agenda_id`) REFERENCES `board_agendas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `board_agenda_comments_agenda_created_idx` ON `board_agenda_comments` (`agenda_id`,`created_at`);
