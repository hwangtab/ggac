-- 메일함 담당자 — 받은 메일에 담당자(`assigned_to`)와 지정 시각·지정한 사람을 더한다.
--
-- ## 왜
--
-- 공유 메일함에서 "누가 이 메일을 맡았나"가 메일 밖에 있었다. 관리자가 이사·감사·관리자 중 한 사람을 지정하고,
-- 지정받은 사람에게 업무툴 웹 푸시가 간다. 목록은 "내 담당"으로 거를 수 있다.
--
-- ## 권한(라우트가 판정한다 — 이 DDL에는 경계가 없다)
--
-- 지정·해제는 관리자만(상태 변경과 같은 등급), 후보는 **지금** 이사·감사·관리자인 승인·활성 회원만
-- (`canAccessBoardRoom`). 이사에서 빠진 사람에게 남은 지정은 그대로 보이지만 새로 지정할 수는 없다.
--
-- 기존 행은 비어 있다(담당자 없음). 프로필이 지워지면 비운다(ON DELETE SET NULL) — SQLite는 `ADD COLUMN`의
-- REFERENCES를 기본값이 NULL일 때 허용한다.
--
-- 롤백: `DROP INDEX inbound_emails_assigned_idx;` 뒤 세 칸을 `DROP COLUMN`.
--
-- BEGIN/COMMIT은 0033과 같은 관례다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `assigned_to` text REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `assigned_at` integer;
--> statement-breakpoint
ALTER TABLE `inbound_emails` ADD COLUMN `assigned_by` text REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `inbound_emails_assigned_idx` ON `inbound_emails` (`assigned_to`,`received_at`);
--> statement-breakpoint
COMMIT;
