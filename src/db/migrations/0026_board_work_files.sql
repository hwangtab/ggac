-- 이사회 업무툴 2단계 — 파일(첨부·자료실, kosmart-work 이식). 설계: docs/board-work/01-설계.md §4·§7.
--
-- 원본은 kosmart-work Postgres `work.pending_uploads`(0003·0034)와 `work.attachments`(0001·0022·0032)다. 옮기면서:
-- - 표 이름에 `work_` 접두사, 사람 FK는 `member_profiles`. CHECK·트리거는 두지 않는다(0025와 같다).
-- - `bucket_path` 대신 `blob_path` — 비공개 Vercel Blob 키(`board-work/files/<uploadId>/<asciiSafeName>`).
--   원본처럼 `pending/`에서 옮기지 않는다: 처음부터 최종 키에 올리고 승격은 행만 바꾼다(§7-1).
-- - 원본 harden_attachments_write(업로더 강제·경로 규약)·is_latest 재계산 트리거는 **옮기지 않았다.**
--   쓰기 함수(`src/db/queries/work/files.ts`)와 순수 경로 검사(`src/lib/storage/boardWork.ts`)가 지킨다.
-- - 버전 열 넷은 3단계(버전)가 표를 바꾸지 않게 지금 둔다. 계보 키 coalesce(version_root_id, id)는
--   drizzle-kit이 식 안 쉼표를 자르므로 CASE로 썼다(같은 값이다).
--
-- DDL은 `src/db/schema/work.ts`를 drizzle-kit push로 빈 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다(0025와 같다).
BEGIN;

CREATE TABLE `work_pending_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`blob_path` text NOT NULL,
	`name` text NOT NULL,
	`mime` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer NOT NULL,
	`draft_meta` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `work_pending_uploads_blob_path_key` ON `work_pending_uploads` (`blob_path`);
CREATE INDEX `work_pending_uploads_created_idx` ON `work_pending_uploads` (`created_at`);
CREATE INDEX `work_pending_uploads_uploader_idx` ON `work_pending_uploads` (`uploader_id`);

CREATE TABLE `work_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`uploader_id` text,
	`blob_path` text NOT NULL,
	`name` text NOT NULL,
	`mime` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`folder_path` text,
	`previous_attachment_id` text,
	`version_root_id` text,
	`version_no` integer DEFAULT 1 NOT NULL,
	`is_latest` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`previous_attachment_id`) REFERENCES `work_attachments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`version_root_id`) REFERENCES `work_attachments`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `work_attachments_blob_path_key` ON `work_attachments` (`blob_path`);
CREATE INDEX `work_attachments_channel_idx` ON `work_attachments` (`channel_id`,"created_at" DESC);
CREATE INDEX `work_attachments_channel_latest_idx` ON `work_attachments` (`channel_id`,"created_at" DESC) WHERE "is_latest" = 1;
CREATE INDEX `work_attachments_folder_idx` ON `work_attachments` (`channel_id`,`folder_path`);
CREATE UNIQUE INDEX `work_attachments_lineage_version_uidx` ON `work_attachments` ((CASE WHEN "version_root_id" IS NULL THEN "id" ELSE "version_root_id" END),`version_no`);
CREATE INDEX `work_attachments_message_idx` ON `work_attachments` (`message_id`);
CREATE INDEX `work_attachments_previous_idx` ON `work_attachments` (`previous_attachment_id`) WHERE "previous_attachment_id" is not null;
CREATE INDEX `work_attachments_uploader_idx` ON `work_attachments` (`uploader_id`);
CREATE INDEX `work_attachments_version_root_idx` ON `work_attachments` (`version_root_id`) WHERE "version_root_id" is not null;

COMMIT;
