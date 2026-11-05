-- 메일함 발신자 규칙 — 특정 주소·도메인에서 온 메일을 받는 즉시 스팸·보관 처리하거나 라벨을 붙인다(`mail_sender_rules`).
--
-- ## 왜
--
-- 같은 곳에서 반복해 오는 광고·자동 알림을 매번 손으로 스팸·보관으로 옮기고 있었다. 수신 웹훅이 메일을 저장한
-- 뒤 응답 뒤에(`after`) 규칙을 적용한다 — 적용이 실패해도 메일은 잃지 않는다(기록만 남는다).
--
-- ## 권한(라우트가 판정한다 — 이 DDL에는 경계가 없다)
--
-- 관리자만 만들고 지운다. 공용 메일 도메인(gmail.com·naver.com 등) 전체를 거는 규칙은 라우트가 한 번 더 확인을
-- 받는다 — 조합원·협력처 메일까지 스팸으로 가지 않게.
--
-- 같은 조건·동작·라벨의 규칙은 하나만 — 부분 유일 인덱스 둘(라벨 없는 규칙·라벨 규칙). NULL은 유일 인덱스에서 서로
-- 다른 값으로 치므로 한 인덱스로는 라벨 없는 규칙의 중복을 막지 못한다. 라벨을 지우면 그 라벨 규칙도 지운다.
-- DDL은 `src/db/schema/mailbox.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- 새 표만 만든다. 롤백: `DROP TABLE mail_sender_rules;`
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
CREATE TABLE `mail_sender_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`match_type` text NOT NULL,
	`match_value` text NOT NULL,
	`action` text NOT NULL,
	`label_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`label_id`) REFERENCES `mail_labels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_sender_rules_plain_idx` ON `mail_sender_rules` (`match_type`,`match_value`,`action`) WHERE "mail_sender_rules"."label_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_sender_rules_label_idx` ON `mail_sender_rules` (`match_type`,`match_value`,`action`,`label_id`) WHERE "mail_sender_rules"."label_id" is not null;
--> statement-breakpoint
COMMIT;
