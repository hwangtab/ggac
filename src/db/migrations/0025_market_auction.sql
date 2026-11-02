-- 조합원 장터 경매: 경매 칸(`market_auctions`, 매물과 1:1)과 입찰 기록(`market_bids`).
--
-- 매물 자체는 0024의 `market_listings`에 `deal_type = 'auction'`으로 들어간다.
-- deal_type은 CHECK가 없는 text라 DDL 변경이 없다(허용값의 정본은
-- `src/constants/market.ts`).
--
-- current_price·current_bidder_id·bid_count는 market_bids에서 계산할 수 있는
-- 값을 일부러 복제한 것이다. 입찰을 "현재가 + 호가 단위 이상"을 조건으로 건
-- UPDATE 한 문장으로 받아야 동시 입찰 둘이 둘 다 이기지 못한다
-- (`src/db/schema/market.ts` 주석).
--
-- current_bidder_id·winner_id는 ON DELETE SET NULL — 회원 행이 지워져도 경매
-- 기록(금액·마감)은 남는다. 탈퇴는 행을 지우지 않고 익명화하므로 평소에는 타지
-- 않는다.
--
-- created_at·updated_at DEFAULT와 BEGIN/COMMIT은 0018과 같은 이유다.
BEGIN;

CREATE TABLE `market_auctions` (
	`listing_id` text PRIMARY KEY NOT NULL,
	`start_price` integer NOT NULL,
	`min_increment` integer NOT NULL,
	`current_price` integer,
	`current_bidder_id` text,
	`bid_count` integer DEFAULT 0 NOT NULL,
	`ends_at` integer NOT NULL,
	`original_ends_at` integer NOT NULL,
	`state` text DEFAULT 'live' NOT NULL,
	`winner_id` text,
	`winning_price` integer,
	`closed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `market_listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_bidder_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`winner_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `market_auctions_state_ends_idx` ON `market_auctions` (`state`,`ends_at`);

CREATE TABLE `market_bids` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`bidder_id` text NOT NULL,
	`amount` integer NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `market_listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bidder_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `market_bids_listing_idx` ON `market_bids` (`listing_id`,`amount` DESC);
CREATE INDEX `market_bids_bidder_idx` ON `market_bids` (`bidder_id`);

COMMIT;
