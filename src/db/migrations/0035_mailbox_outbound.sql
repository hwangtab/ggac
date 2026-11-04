-- 관리자 메일함 "새 메일 작성" — 보낸 메일 표 둘을 더한다.
--
-- ## 왜
--
-- 메일함은 받은 메일에 대한 답장(`inbound_email_replies`)만 보낼 수 있었다. 새 메일을 작성해 보내려면
-- 받은 메일에 매이지 않는 원장이 필요하다. `inbound_email_replies.email_id`를 nullable로 바꾸는 길은
-- SQLite가 NOT NULL을 풀 수 없어 표 재작성이 필요하고(0002 사고의 종류), 그래서 새 표를 더한다.
-- 보낸 편지함은 쿼리 계층에서 두 표를 합쳐 보여준다.
--
-- `idempotency_key` 의 UNIQUE 가 더블클릭·재전송의 중복 발송을 막는 장치다. 발송 **전에**
-- `sending` 행을 먼저 쓰고 결과로 갱신한다 — 일일 상한을 이 표의 합계로 세기 때문이고, 함수가 발송
-- 도중 죽어도 흔적이 남기 때문이다.
--
-- ## 어떻게 만들었나
--
-- `drizzle-kit push` 로 빈 DB 에 밀어 넣은 뒤 `sqlite_master` 의 DDL 을 그대로 옮겼다. 손으로 쓰지
-- 않았다. 새 표만 만들고 기존 표는 건드리지 않으므로 재작성도 FK 끄기도 필요 없다. 롤백은
-- `DROP TABLE outbound_email_attachments; DROP TABLE outbound_emails;` 이다.
--
-- BEGIN/COMMIT 과 `executeMultiple()` 적용 경로는 0013~0032 와 같다 — `drizzle-kit migrate` 로
-- 적용하지 마라(`scripts/turso/README.md`).
BEGIN;
--> statement-breakpoint
CREATE TABLE `outbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`to_addresses` text NOT NULL,
	`cc_addresses` text,
	`bcc_addresses` text,
	`recipient_count` integer NOT NULL,
	`subject` text NOT NULL,
	`body_html` text NOT NULL,
	`sent_by` text,
	`sent_by_email` text,
	`status` text DEFAULT 'sending' NOT NULL,
	`resend_message_id` text,
	`error` text,
	`sent_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`sent_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_emails_idempotency_key_unique` ON `outbound_emails` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `outbound_emails_created_idx` ON `outbound_emails` (`created_at`);
--> statement-breakpoint
CREATE INDEX `outbound_emails_status_idx` ON `outbound_emails` (`status`);
--> statement-breakpoint
CREATE INDEX `outbound_emails_sent_by_idx` ON `outbound_emails` (`sent_by`);
--> statement-breakpoint
CREATE TABLE `outbound_email_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text,
	`size_bytes` integer NOT NULL,
	`blob_path` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `outbound_emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outbound_email_attachments_email_idx` ON `outbound_email_attachments` (`email_id`);
--> statement-breakpoint
COMMIT;
