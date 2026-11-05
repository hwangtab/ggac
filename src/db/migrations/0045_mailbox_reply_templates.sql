-- 메일함 답장 템플릿 — 자주 쓰는 안내문(`mail_reply_templates`).
--
-- ## 왜
--
-- 대관 안내·후원 영수증·가입 안내 같은 같은 답을 매번 새로 쓰고 있었다. 답장·새 메일 작성 창에서 골라 본문 끝에
-- 덧붙인다(치환 변수 없음).
--
-- 관리자만 만들고 고치고 지운다(라우트가 판정 — 답장·새 메일 작성이 관리자만이라 같은 등급). 이름은 대소문자를
-- 가리지 않고 겹칠 수 없다 — `lower(name)` 유일 인덱스. 길이(이름 1~40자, 본문 1~5000자)는 라우트가 지킨다.
-- DDL은 `src/db/schema/mailbox.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- 새 표만 만든다. 롤백: `DROP TABLE mail_reply_templates;`
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
CREATE TABLE `mail_reply_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_reply_templates_name_idx` ON `mail_reply_templates` (lower("name"));
--> statement-breakpoint
COMMIT;
