-- 조합원 '내 문서함' — 문서·버전·임시 업로드. 설계: docs/board-work/04-조합원-문서함.md §2.
--
-- 0027~0034(이사회 업무툴)와 같은 규칙:
-- - 사람 FK는 `member_profiles`, CHECK 없음. `source` 허용값('upload'·'editor'·'restore')과 이름 길이는
--   `src/lib/memberDocuments/rules.ts`·`src/db/queries/memberDocuments.ts`가 지킨다.
-- - **소유 경계가 DB에 없다.** 모든 쿼리가 `owner_id`를 인자로 받아 WHERE에 넣고, 라우트가 `requireActiveMember()`로
--   그 값을 확정한다(`/api/mypage/documents/**`). 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
-- - 객체(비공개 Blob `member-documents/<ownerId>/<versionId>/…`)는 DB가 지우지 않는다 — 문서 삭제·보존 크론
--   (`/api/internal/member-documents/retention`)이 행보다 먼저 지운다.
-- - 이 마이그레이션은 행을 넣지 않는다. 기능 스위치(`features/member_documents`)는 행이 없으면 꺼짐이다.
--
-- DDL은 `src/db/schema/memberDocuments.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- BEGIN/COMMIT은 0018·0027과 같은 이유다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;

CREATE TABLE `member_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`latest_version_no` integer DEFAULT 1 NOT NULL,
	`last_opened_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deletion_notified_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `member_documents_owner_idx` ON `member_documents` (`owner_id`,`updated_at`);
CREATE INDEX `member_documents_last_opened_idx` ON `member_documents` (`last_opened_at`);

CREATE TABLE `member_document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`name` text NOT NULL,
	`mime` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer NOT NULL,
	`blob_path` text NOT NULL,
	`source` text DEFAULT 'upload' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `member_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `member_document_versions_doc_no_key` ON `member_document_versions` (`document_id`,`version_no`);
CREATE UNIQUE INDEX `member_document_versions_blob_path_key` ON `member_document_versions` (`blob_path`);
CREATE INDEX `member_document_versions_owner_idx` ON `member_document_versions` (`owner_id`);

CREATE TABLE `member_document_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`document_id` text,
	`blob_path` text NOT NULL,
	`name` text NOT NULL,
	`mime` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `member_documents`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `member_document_uploads_blob_path_key` ON `member_document_uploads` (`blob_path`);
CREATE INDEX `member_document_uploads_owner_idx` ON `member_document_uploads` (`owner_id`);
CREATE INDEX `member_document_uploads_created_idx` ON `member_document_uploads` (`created_at`);

COMMIT;
