-- 조합원 타임뱅크 1-A: 참여자 프로필·게시판·조합 업무 자원·원장·재가입 승계 키.
-- 스펙: docs/superpowers/specs/2026-11-02-member-timebank-design.md §3.
--
-- 왜 표를 따로 두는가: 장터(0024)와 같다. 이 표들을 읽는 코드는
-- `/api/timebank/*`와 관리자·이사회 라우트뿐이라 기본값이 비공개다
-- (`src/db/schema/timebank.ts` 머리 주석).
--
-- 허용값(kind·status·category·ref_type 등)은 `src/constants/timebank.ts`가
-- 정본이고 CHECK는 `minutes > 0` 하나만 둔다(상수와 무관한 불변식이라서).
-- 부분 유일 인덱스 다섯 개와 CHECK는 Drizzle 스키마에도 선언했다 — 선언하지
-- 않으면 `drizzle-kit push`가 지운다.
--
-- 트리거 세 개(이 저장소의 첫 트리거)가 원장 불변성을 지킨다:
--   1. 핵심 칸 고정 — 상태와 무관하게 `UPDATE OF` 목록의 칸은 바뀌지 않는다.
--      목록 방식이라 나중에 컬럼을 더해도 핵심 칸은 그대로 잠겨 있다.
--   2. 확정 후 고정 — pending이 아닌 행은 이름을 묘비 표시명으로 덮는 것
--      말고는 바뀌지 않는다. 묘비 표시명 '탈퇴한 조합원'은
--      `WITHDRAWN_DISPLAY_NAME`(src/constants/memberProfile.ts, withdrawal.ts가
--      쓴다)과 같은 값이어야 하고 `timebankSchema.test.mjs`가 고정한다.
--      updated_at은 비교하지 않는다(Drizzle `$onUpdate`가 묘비 덮기 때도 쓴다).
--      비교는 `IS`로 한다 — `IN`/`=`는 이름이 NULL인 행에서 NULL이 되어 WHEN이
--      거짓으로 떨어지고, 그러면 NULL 이름을 아무 값으로나 덮을 수 있다.
--   3. 삭제 금지 — 보존 기간 뒤 폐기는 scripts/turso의 수동 절차로만 한다.
-- `drizzle-kit push`는 트리거를 모르므로 `db:push:local`로 만든 DB(E2E 포함)에는
-- 트리거가 없다. 운영은 이 파일을 `executeMultiple`로 수동 적용하므로 생긴다.
--
-- created_at·updated_at DEFAULT와 BEGIN/COMMIT은 0018과 같은 이유다.
-- 인덱스 이름은 표 이름 접두사를 쓴다(`idx_`는 0004·0005의 이름 공간이다).
BEGIN;

CREATE TABLE `timebank_profiles` (
	`member_id` text PRIMARY KEY NOT NULL,
	`offers` text DEFAULT '' NOT NULL,
	`needs` text DEFAULT '' NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`visible` integer DEFAULT false NOT NULL,
	`terms_version` text,
	`agreed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `timebank_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`estimated_minutes` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`task_date` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `timebank_listings_list_idx` ON `timebank_listings` (`is_deleted`,`kind`,`status`,`created_at` DESC);
CREATE INDEX `timebank_listings_author_idx` ON `timebank_listings` (`author_id`,`created_at` DESC);

CREATE TABLE `timebank_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `timebank_listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `timebank_comments_listing_idx` ON `timebank_comments` (`listing_id`,`created_at`);

CREATE TABLE `timebank_task_volunteers` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`member_id` text NOT NULL,
	`volunteered_at` integer NOT NULL,
	`withdrawn_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `timebank_listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `timebank_task_volunteers_pair_uq` ON `timebank_task_volunteers` (`listing_id`,`member_id`);

CREATE TABLE `timebank_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`from_account` text NOT NULL,
	`to_account` text NOT NULL,
	`minutes` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_by` text,
	`counterparty_id` text,
	`decided_by` text,
	`decided_at` integer,
	`ref_type` text,
	`ref_id` text,
	`reverses_id` text,
	`category` text,
	`memo` text,
	`from_name` text,
	`to_name` text,
	`approved_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "timebank_transfers_minutes_positive" CHECK("minutes" > 0)
);
CREATE INDEX `timebank_transfers_from_idx` ON `timebank_transfers` (`from_account`,`status`);
CREATE INDEX `timebank_transfers_to_idx` ON `timebank_transfers` (`to_account`,`status`);
CREATE INDEX `timebank_transfers_status_created_idx` ON `timebank_transfers` (`status`,`created_at`);
CREATE INDEX `timebank_transfers_counterparty_idx` ON `timebank_transfers` (`counterparty_id`,`status`);
CREATE UNIQUE INDEX `timebank_transfers_signup_grant_uq` ON `timebank_transfers` (`to_account`) WHERE "kind" = 'signup_grant';
CREATE UNIQUE INDEX `timebank_transfers_reversal_uq` ON `timebank_transfers` (`reverses_id`) WHERE "reverses_id" IS NOT NULL AND "status" IN ('pending', 'confirmed');
CREATE UNIQUE INDEX `timebank_transfers_market_uq` ON `timebank_transfers` (`ref_id`) WHERE "kind" = 'market' AND "status" IN ('pending', 'confirmed');
CREATE UNIQUE INDEX `timebank_transfers_carryover_uq` ON `timebank_transfers` (`from_account`) WHERE "kind" = 'carryover';
CREATE UNIQUE INDEX `timebank_transfers_coop_task_uq` ON `timebank_transfers` (`ref_id`,`to_account`) WHERE "kind" = 'coop_task' AND "status" = 'confirmed';

CREATE TRIGGER `timebank_transfers_core_immutable`
BEFORE UPDATE OF `id`, `from_account`, `to_account`, `minutes`, `kind`, `created_by`, `counterparty_id`,
  `ref_type`, `ref_id`, `reverses_id`, `created_at` ON `timebank_transfers`
BEGIN
  SELECT RAISE(ABORT, 'timebank_transfers: core columns are immutable');
END;

CREATE TRIGGER `timebank_transfers_final_immutable`
BEFORE UPDATE ON `timebank_transfers`
WHEN OLD.`status` <> 'pending' AND NOT (
  (NEW.`from_name` IS OLD.`from_name` OR NEW.`from_name` IS '탈퇴한 조합원')
  AND (NEW.`to_name` IS OLD.`to_name` OR NEW.`to_name` IS '탈퇴한 조합원')
  AND NEW.`status` IS OLD.`status`
  AND NEW.`memo` IS OLD.`memo`
  AND NEW.`category` IS OLD.`category`
  AND NEW.`decided_by` IS OLD.`decided_by`
  AND NEW.`decided_at` IS OLD.`decided_at`
  AND NEW.`approved_by` IS OLD.`approved_by`
)
BEGIN
  SELECT RAISE(ABORT, 'timebank_transfers: finalized rows are immutable');
END;

CREATE TRIGGER `timebank_transfers_no_delete`
BEFORE DELETE ON `timebank_transfers`
BEGIN
  SELECT RAISE(ABORT, 'timebank_transfers: rows are never deleted');
END;

CREATE TABLE `timebank_withdrawn_keys` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`balance_minutes` integer NOT NULL,
	`withdrawn_at` integer NOT NULL
);

COMMIT;
