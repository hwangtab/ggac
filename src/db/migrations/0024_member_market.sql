-- 조합원 장터: 매물(`market_listings`)과 거래 문의 댓글(`market_comments`).
--
-- 왜 `posts`에 카테고리로 얹지 않고 표를 따로 두는가: 게시판은 비회원도 읽고
-- 상세 `/board/[id]`가 ISR이라 렌더된 HTML이 공용 캐시에 남는다. 장터는
-- 조합원 전용이어야 하는데, `posts`에 넣으면 공개 경로 전부를 하나씩 막아야
-- 하고 빠뜨린 곳으로 조용히 샌다. 따로 두면 기본값이 비공개다
-- (`src/db/schema/market.ts` 머리 주석).
--
-- 허용값(deal_type·item_category·status·item_condition·trade_method)은
-- `src/constants/market.ts`가 정본이고 CHECK를 두지 않는다 — 0022 펀딩과 같다.
--
-- images는 JSON 배열 텍스트다. 업로드 정리 크론이 instr()로 이 칸을 참조로
-- 센다(`src/db/queries/uploads.ts`).
--
-- created_at·updated_at DEFAULT와 BEGIN/COMMIT은 0018과 같은 이유다.
-- 인덱스 이름은 0016~0018처럼 표 이름 접두사를 쓴다(`idx_`는 0004·0005의
-- 이름 공간이다).
BEGIN;

CREATE TABLE `market_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`deal_type` text NOT NULL,
	`item_category` text NOT NULL,
	`price` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`item_condition` text,
	`trade_method` text,
	`region` text,
	`images` text DEFAULT '[]' NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`status_changed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `market_listings_list_idx` ON `market_listings` (`is_deleted`,`status`,`created_at` DESC);
CREATE INDEX `market_listings_seller_idx` ON `market_listings` (`seller_id`,`created_at` DESC);

CREATE TABLE `market_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `market_listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `market_comments_listing_idx` ON `market_comments` (`listing_id`,`created_at`);

COMMIT;
