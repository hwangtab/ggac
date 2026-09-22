-- src/db/migrations/0022_funding.sql
-- 조합원 프로젝트 펀딩: 캠페인·리워드·후원·정산.
--
-- 설계: docs/superpowers/specs/2026-09-21-member-project-funding-design.md
-- 결제 원장은 기존 payments를 쓴다(kind='funding'). kind는 text라 DDL 변경 없음.
--
-- created_at·updated_at DEFAULT와 BEGIN/COMMIT은 0018과 같은 이유다.
-- funding_pledges.order_id는 유일 — 한 주문이 두 후원을 확정하면 초과 판매다.
BEGIN;

CREATE TABLE `funding_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`owner_user_id` text,
	`project_slug` text,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`story` text DEFAULT '' NOT NULL,
	`cover_image` text,
	`og_image` text,
	`category` text DEFAULT '기타' NOT NULL,
	`goal_amount` integer NOT NULL,
	`start_at` integer,
	`end_at` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`review_note` text,
	`submitted_at` integer,
	`approved_at` integer,
	`closed_at` integer,
	`settled_at` integer,
	`platform_fee_rate` integer DEFAULT 0 NOT NULL,
	`terms_version` text,
	`terms_agreed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `funding_campaigns_slug_unique` ON `funding_campaigns` (`slug`);
CREATE INDEX `funding_campaigns_status_idx` ON `funding_campaigns` (`status`);
CREATE INDEX `funding_campaigns_owner_idx` ON `funding_campaigns` (`owner_user_id`);

CREATE TABLE `funding_rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`amount` integer NOT NULL,
	`total_quantity` integer,
	`requires_shipping` integer DEFAULT 0 NOT NULL,
	`estimated_delivery` text,
	`image_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`locked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `funding_campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `funding_rewards_campaign_idx` ON `funding_rewards` (`campaign_id`,`sort_order`);

CREATE TABLE `funding_pledges` (
	`id` text PRIMARY KEY NOT NULL,
	`pledge_code` text NOT NULL,
	`campaign_id` text NOT NULL,
	`reward_id` text NOT NULL,
	`user_id` text,
	`order_id` text NOT NULL,
	`payment_id` text,
	`backer_name` text NOT NULL,
	`backer_email` text NOT NULL,
	`backer_phone` text,
	`reward_title` text NOT NULL,
	`unit_amount` integer NOT NULL,
	`quantity` integer NOT NULL,
	`additional_amount` integer DEFAULT 0 NOT NULL,
	`total_amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`hold_expires_at` integer,
	`paid_at` integer,
	`canceled_at` integer,
	`refunded_at` integer,
	`is_anonymous` integer DEFAULT 0 NOT NULL,
	`supporter_message` text,
	`message_public` integer DEFAULT 0 NOT NULL,
	`shipping_name` text,
	`shipping_phone` text,
	`shipping_postcode` text,
	`shipping_address1` text,
	`shipping_address2` text,
	`shipping_memo` text,
	`fulfillment_status` text DEFAULT 'none' NOT NULL,
	`entry_source` text DEFAULT 'online' NOT NULL,
	`terms_version` text,
	`terms_agreed_at` integer,
	`privacy_agreed_at` integer,
	`admin_memo` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `funding_campaigns`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reward_id`) REFERENCES `funding_rewards`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `funding_pledges_pledge_code_unique` ON `funding_pledges` (`pledge_code`);
CREATE INDEX `funding_pledges_campaign_status_idx` ON `funding_pledges` (`campaign_id`,`status`);
CREATE INDEX `funding_pledges_user_idx` ON `funding_pledges` (`user_id`);
CREATE INDEX `funding_pledges_hold_idx` ON `funding_pledges` (`status`,`hold_expires_at`);
CREATE INDEX `funding_pledges_reward_idx` ON `funding_pledges` (`reward_id`,`status`);
CREATE UNIQUE INDEX `funding_pledges_order_id_idx` ON `funding_pledges` (`order_id`);

CREATE TABLE `funding_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`gross_amount` integer DEFAULT 0 NOT NULL,
	`refund_amount` integer DEFAULT 0 NOT NULL,
	`pg_fee_amount` integer DEFAULT 0 NOT NULL,
	`platform_fee_amount` integer DEFAULT 0 NOT NULL,
	`payout_amount` integer DEFAULT 0 NOT NULL,
	`backer_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_out_at` integer,
	`memo` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `funding_campaigns`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `funding_settlements_campaign_id_unique` ON `funding_settlements` (`campaign_id`);

COMMIT;
