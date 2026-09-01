-- ⚠ **적용은 파일을 통째로 실행하는 경로로만 한다**(`executeMultiple`).
-- `drizzle-kit migrate`는 쓰지 않는다 — 이 저장소의 규약이고, 마이그레이터가
-- 자체 트랜잭션으로 감싸면 아래 `BEGIN`이 즉시 실패한다.
--
-- **왜 BEGIN/COMMIT이 붙었나.** 원래 이 파일에는 트랜잭션이 없었다. 그런데
-- `executeMultiple()`은 **문마다 자동 커밋**하므로 중간에 한 문이 실패하면
-- 앞 문들이 그대로 남는다. 그 반쪽 상태는 재실행으로 복구되지 않는다 —
-- 실측(2026-09-01): 두 번째 표가 이미 있는 DB에 이 파일을 적용하면 첫 표만
-- 만들어진 채 실패하고, 다시 돌리면 이번엔 그 첫 표 때문에 실패해 **손으로
-- DROP하기 전까지 영구 교착**이었다.
--
-- 이제 실패하면 전체가 롤백되어 아무것도 남지 않는다(= 그냥 다시 돌리면 된다).
BEGIN;
--> statement-breakpoint
CREATE TABLE `membership_dues` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`billing_month` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`payment_id` text,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_dues_user_month_idx` ON `membership_dues` (`user_id`,`billing_month`);--> statement-breakpoint
CREATE TABLE `payments` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_order_id_unique` ON `payments` (`order_id`);
--> statement-breakpoint
COMMIT;
