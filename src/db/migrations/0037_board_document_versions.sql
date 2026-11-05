-- 이사회 서류 앱 편집 — 버전 기록. 설계: docs/board-work/05-이사회-서류-앱-편집.md §2.
--
-- 0036(조합원 내 문서함)과 같은 규칙:
-- - 사람 FK는 `member_profiles`, CHECK 없음. `source` 허용값('upload'·'office-editor'·'hwp-editor'·'revert')은
--   `src/lib/boardDocuments/editRules.ts`·`src/db/queries/boardDocumentVersions.ts`가 지킨다.
-- - **권한 경계가 DB에 없다.** "올린 사람 또는 관리자만 고친다"는 라우트(`/api/board-room/documents/[id]/…`)가
--   `requireBoardMember()` 뒤에 판정한다. 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
-- - **채우지 않는다(backfill 없음).** 한 번도 고치지 않은 서류에는 행이 없다 — 처음 저장할 때 `board_documents`의
--   file_* 칸을 v1 행으로 옮기고 v2 를 넣는다(같은 트랜잭션).
-- - 객체(비공개 Blob `board-documents/versions/<서류>/<버전>/…`)는 DB가 지우지 않는다 — 서류 삭제 라우트가
--   행을 지운 뒤 지운다(기존 삭제 라우트와 같은 순서·근거).
--
-- DDL은 `src/db/schema/board.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- BEGIN/COMMIT은 0018·0027·0036과 같은 이유다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;

CREATE TABLE `board_document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`mime_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`source` text DEFAULT 'upload' NOT NULL,
	`created_by` text,
	`body_markdown` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `board_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `board_document_versions_doc_no_key` ON `board_document_versions` (`document_id`,`version_no`);

COMMIT;
