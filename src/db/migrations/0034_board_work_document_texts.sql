-- 이사회 업무툴 — 이사회 서류(`board_documents`, 서류함·정기총회 자료) 파일 본문 추출 결과. 설계:
-- docs/board-work/03-통합-재설계.md §10(R4 — 자료실의 '이사회 서류').
--
-- 업무 검색의 '이사회 서류' 묶음이 제목·파일 이름·`body_markdown`에 더해 PDF·HWP·DOCX 등 파일 속 글자에서도 찾게 한다.
-- 모양과 규칙은 0031 `work_attachment_texts`와 같다:
-- - `work_` 접두사, CHECK 없음(상태 허용값 ok·unsupported·failed·too_large, 본문 2,000,000자 상한은 쓰기 함수
--   `src/db/queries/work/boardDocumentTexts.ts`가 지킨다).
-- - FTS5·색인 없이 instr(lower(…))로 찾는다(0031·설계 §8-3과 같은 이유).
-- - 채널 열이 없다. 열람 범위는 **서류 행의 `visibility`**로 검색 쿼리(`searchDocuments`, src/db/queries/board.ts)가
--   WHERE 에서 건다. 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
-- - 서류를 지우면 결과 행도 지워진다(ON DELETE CASCADE). 기존 서류는 추출 크론(`/api/internal/board-work/extract-texts`)이
--   최신 순으로 채운다 — 이 마이그레이션은 행을 넣지 않는다.
--
-- DDL은 `src/db/schema/work.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- BEGIN/COMMIT은 0018·0027·0031과 같은 이유다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;

CREATE TABLE `work_board_document_texts` (
	`document_id` text PRIMARY KEY NOT NULL,
	`ext` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`extractor_version` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`extracted_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `board_documents`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `work_board_document_texts_failed_idx` ON `work_board_document_texts` (`extracted_at`) WHERE "status" = 'failed';

COMMIT;
