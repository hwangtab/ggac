-- 관리자 메일함 표 셋을 더한다.
--
-- ## 왜
--
-- ggac.kr 수신을 카카오 스마트워크에서 Resend Inbound로 옮긴다. Resend는 받은
-- 메일을 30일만 보관하고 첨부 다운로드 URL은 한 시간이면 만료되므로, 수신
-- 즉시 본문과 첨부를 여기에 옮겨 담는다. 이 표가 정본이고 Resend는 배달
-- 통로일 뿐이다.
--
-- `resend_email_id` 의 UNIQUE 가 웹훅 재전송을 걸러내는 멱등성 키다. 이게
-- 없으면 Resend 가 재시도할 때마다 같은 메일이 새 행으로 쌓인다.
--
-- `body_fetch_status` 는 본문·첨부를 아직 못 당겨온 행을 표시한다. 웹훅은
-- 당기기에 실패해도 200 을 돌려주고(재시도 폭주를 부르지 않는다) 이 값을
-- 'pending' 으로 두며, 백필 크론이 나중에 채운다.
--
-- ## 어떻게 만들었나
--
-- `npm run db:push:local` 로 빈 DB 에 밀어 넣은 뒤 `sqlite_master` 의 DDL 을
-- 그대로 옮겼다. 손으로 쓰지 않았다 — 0002 가 손으로 쓴 재작성으로 컬럼과
-- 인덱스를 지운 사고가 있다.
--
-- 새 표만 만들고 기존 표는 건드리지 않으므로 재작성도 FK 끄기도 필요 없다.
--
-- BEGIN/COMMIT 과 `executeMultiple()` 적용 경로는 0013~0019 와 같다 —
-- `drizzle-kit migrate` 로 적용하지 마라(`scripts/turso/README.md`).
BEGIN;
--> statement-breakpoint
CREATE TABLE `inbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`resend_email_id` text NOT NULL,
	`message_id` text,
	`from_address` text NOT NULL,
	`to_addresses` text NOT NULL,
	`cc_addresses` text,
	`received_for` text,
	`subject` text,
	`body_html` text,
	`body_text` text,
	`headers` text,
	`status` text DEFAULT 'unread' NOT NULL,
	`body_fetch_status` text DEFAULT 'pending' NOT NULL,
	`thread_references` text,
	`received_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_emails_resend_email_id_unique` ON `inbound_emails` (`resend_email_id`);
--> statement-breakpoint
CREATE INDEX `inbound_emails_status_idx` ON `inbound_emails` (`status`);
--> statement-breakpoint
CREATE INDEX `inbound_emails_received_idx` ON `inbound_emails` (`received_at`);
--> statement-breakpoint
CREATE INDEX `inbound_emails_from_idx` ON `inbound_emails` (`from_address`);
--> statement-breakpoint
CREATE INDEX `inbound_emails_fetch_status_idx` ON `inbound_emails` (`body_fetch_status`);
--> statement-breakpoint
CREATE TABLE `inbound_email_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text,
	`content_id` text,
	`size_bytes` integer,
	`blob_path` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `inbound_emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inbound_email_attachments_email_idx` ON `inbound_email_attachments` (`email_id`);
--> statement-breakpoint
CREATE TABLE `inbound_email_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`sent_by` text,
	`subject` text NOT NULL,
	`body_html` text NOT NULL,
	`resend_message_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `inbound_emails`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sent_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inbound_email_replies_email_idx` ON `inbound_email_replies` (`email_id`);
--> statement-breakpoint
-- 재실행 차단: 이미 적용됐으면 롤백한다.
CREATE TABLE `__migration_assert_0020` (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
--> statement-breakpoint
INSERT INTO `__migration_assert_0020` (ok)
SELECT CASE WHEN (SELECT count(*) FROM sqlite_master
                  WHERE type = 'table' AND name = 'inbound_emails') = 1
            THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `__migration_assert_0020`;
--> statement-breakpoint
COMMIT;
