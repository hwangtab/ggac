-- 이사회 업무툴 3단계 — 문서 버전·체크아웃(kosmart-work 이식). 설계: docs/board-work/01-설계.md §4·§5·§8-1.
--
-- 원본은 kosmart-work Postgres `work.file_lineages`(0032)와 `work.attachments`의 버전 트리거(0032·0035·0039)다. 옮기면서:
-- - 0026과 같은 규칙: `work_` 접두사, 사람 FK는 `member_profiles`, CHECK 없음.
-- - 버전 열(previous_attachment_id·version_root_id·version_no·is_latest)과 계보 유일 인덱스는 0027이 이미 만들었다.
--   이 파일은 계보 행 표(최종본·수정 중) 하나만 더한다.
-- - 원본 트리거는 **옮기지 않았다.** harden_attachments_write의 계보 규칙(같은 채널만 잇기·root/번호 강제 계산·
--   앞 버전이 지금 최신이 아니면 P0409·특권 열 동결·경로 규약)과 recompute_attachment_latest(첨부 INSERT 뒤·메시지
--   삭제 뒤)는 `src/db/queries/work/files.ts`·`messages.ts` 쓰기 함수가 같은 트랜잭션에서 지킨다. 동시 저장 경합은
--   0027의 work_attachments_lineage_version_uidx가 잡는다. 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
-- - 원본의 변경 신호 트리거(broadcast_file_lineage_change)는 받는 화면이 없어 옮기지 않았다.
--
-- DDL은 `src/db/schema/work.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- BEGIN/COMMIT은 0018·0026과 같은 이유다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;

CREATE TABLE `work_file_lineages` (
	`root_attachment_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`final_attachment_id` text,
	`final_marked_by` text,
	`final_marked_at` integer,
	`checkout_user_id` text,
	`checkout_at` integer,
	`checkout_until` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`root_attachment_id`) REFERENCES `work_attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`final_attachment_id`) REFERENCES `work_attachments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`final_marked_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`checkout_user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `work_file_lineages_channel_idx` ON `work_file_lineages` (`channel_id`);
CREATE INDEX `work_file_lineages_checkout_user_idx` ON `work_file_lineages` (`checkout_user_id`) WHERE "checkout_user_id" is not null;
CREATE INDEX `work_file_lineages_final_idx` ON `work_file_lineages` (`final_attachment_id`) WHERE "final_attachment_id" is not null;
CREATE INDEX `work_file_lineages_final_marked_by_idx` ON `work_file_lineages` (`final_marked_by`) WHERE "final_marked_by" is not null;

COMMIT;
