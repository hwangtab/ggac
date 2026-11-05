-- 메일함 라벨 — 조합이 함께 쓰는 분류(`mail_labels`)와 메일에 붙인 라벨(`inbound_email_labels`).
--
-- ## 왜
--
-- 받은 메일을 상태(안 읽음·보관 등) 말고는 나눌 수단이 없었다. 총회·후원·언론처럼 일의 갈래로 묶어 거른다.
-- 다음 단계의 발신자 규칙(자동 라벨)도 이 표를 쓴다.
--
-- ## 권한(라우트가 판정한다 — 이 DDL에는 경계가 없다)
--
-- 라벨 만들기·고치기·지우기와 메일에 붙이기·떼기는 관리자만(상태 변경과 같은 등급), 보기·거르기는 이사·감사·관리자.
--
-- 이름은 대소문자를 가리지 않고 겹칠 수 없다 — `lower(name)` 유일 인덱스. 메일이나 라벨을 지우면 연결도 지운다.
-- DDL은 `src/db/schema/mailbox.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- 새 표만 만든다. 롤백: `DROP TABLE inbound_email_labels; DROP TABLE mail_labels;`
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
CREATE TABLE `mail_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_labels_name_idx` ON `mail_labels` (lower("name"));
--> statement-breakpoint
CREATE TABLE `inbound_email_labels` (
	`email_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`email_id`, `label_id`),
	FOREIGN KEY (`email_id`) REFERENCES `inbound_emails`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `mail_labels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inbound_email_labels_label_idx` ON `inbound_email_labels` (`label_id`);
--> statement-breakpoint
COMMIT;
