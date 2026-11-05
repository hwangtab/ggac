-- 메일함 다시 알림 — 받은 메일에 다시 알릴 시각(`snoozed_until`)과 건 사람(`snoozed_by`)을 더한다.
--
-- ## 왜
--
-- "다음 주 월요일에 다시 보자"는 메일을 안 읽음으로 두면 목록을 덮고, 보관하면 잊는다. 정한 시각까지 목록에서
-- 숨겼다가, 지나면 메일함 크론(`/api/internal/mailbox/backfill`, 매시 15분)이 안 읽음으로 되돌리고 담당자(없으면
-- 건 사람)에게 웹 푸시를 보낸다. 크론 주기 때문에 최대 한 시간 늦을 수 있다.
--
-- 걸기·풀기는 관리자만(라우트가 판정 — 상태 변경과 같은 등급). 기존 행은 비어 있다. 건 사람의 프로필이 지워지면
-- 비운다(ON DELETE SET NULL — SQLite는 기본값이 NULL인 `ADD COLUMN`의 REFERENCES를 허용한다).
--
-- 롤백: `DROP INDEX inbound_emails_snoozed_idx;` 뒤 두 칸을 `DROP COLUMN`.
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `snoozed_until` integer;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `snoozed_by` text REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `inbound_emails_snoozed_idx` ON `inbound_emails` (`snoozed_until`);
--> statement-breakpoint
COMMIT;
