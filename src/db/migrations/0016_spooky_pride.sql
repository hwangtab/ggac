-- 공연 예매: 공연·회차·티켓 종류·예매 4개 표.
--
-- 조합비와 결정적으로 다른 점은 **수량이 한정돼 있다**는 것이다. 마지막 한
-- 장을 두 사람이 동시에 살 수 있고, 그걸 막지 못하면 팔지 않은 좌석을 판 것이
-- 된다. 초과 판매는 환불로도 되돌릴 수 없다 — 공연 당일 입장을 거절해야 한다.
--
-- 재고는 `performance_shows.capacity`에서 자리를 차지한 예매를 뺀 값이다.
-- 결제 전 선점(`pending`)도 자리를 차지하고, 만료되면 돌려준다.
--
-- 네 표를 한 트랜잭션으로 만드는 이유: `reservations`가 나머지 셋을 전부
-- 참조하므로, 중간에 실패해 일부만 남으면 재실행이 "이미 있다"로 죽는다.

BEGIN;
CREATE TABLE `performance_shows` (
	`id` text PRIMARY KEY NOT NULL,
	`performance_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`capacity` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`performance_id`) REFERENCES `performances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `performance_shows_performance_idx` ON `performance_shows` (`performance_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `performances` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `performances_slug_unique` ON `performances` (`slug`);--> statement-breakpoint
CREATE INDEX `performances_status_idx` ON `performances` (`status`);--> statement-breakpoint
CREATE TABLE `reservations` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `performance_shows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_reservation_code_unique` ON `reservations` (`reservation_code`);--> statement-breakpoint
CREATE INDEX `reservations_show_status_idx` ON `reservations` (`show_id`,`status`);--> statement-breakpoint
CREATE INDEX `reservations_user_idx` ON `reservations` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_code_idx` ON `reservations` (`reservation_code`);--> statement-breakpoint
CREATE TABLE `ticket_types` (
	`id` text PRIMARY KEY NOT NULL,
	`performance_id` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`max_per_order` integer DEFAULT 4 NOT NULL,
	`members_only` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`performance_id`) REFERENCES `performances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_types_performance_idx` ON `ticket_types` (`performance_id`,`sort_order`);
COMMIT;
