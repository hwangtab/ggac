-- 메일함 내부 메모 — 받은 메일마다 이사·감사·관리자가 남기는 조합 안의 글(`inbound_email_notes`).
--
-- ## 왜
--
-- 공유 메일함이라 "누가 이 메일을 보고 있나, 무엇을 확인했나"를 메일 밖(메신저)에서 주고받고 있었다. 메일 옆에
-- 남긴다. 메일로는 나가지 않는다 — 발송 경로(답장·새 메일·전달)는 이 표를 읽는 쿼리를 들여오지 않는다.
--
-- ## 권한(라우트가 판정한다 — 이 DDL에는 경계가 없다)
--
-- 쓰기는 메일함 열람 범위(이사·감사·관리자) 전원(2026-11-05 결정), 고치기는 쓴 사람만, 지우기는 쓴 사람과 관리자다.
-- 본문 길이(1~2000자)도 라우트가 지킨다 — 0027과 같은 규칙으로 CHECK 없음.
--
-- DDL은 `src/db/schema/mailbox.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- 새 표만 만들고 기존 표는 건드리지 않는다. 롤백: `DROP TABLE inbound_email_notes;`
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
CREATE TABLE `inbound_email_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `inbound_emails`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inbound_email_notes_email_idx` ON `inbound_email_notes` (`email_id`,`created_at`);
--> statement-breakpoint
COMMIT;
