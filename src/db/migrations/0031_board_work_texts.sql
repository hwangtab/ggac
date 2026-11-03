-- 이사회 업무툴 4단계 — 첨부 문서 본문 추출 결과(kosmart-work 이식). 설계: docs/board-work/01-설계.md §4·§8-2·§8-3.
--
-- 원본은 kosmart-work Postgres `work.attachment_texts`(0029)다. 옮기면서:
-- - 0027과 같은 규칙: `work_` 접두사, CHECK 없음(상태 허용값·본문 2,000,000자 상한은 쓰기 함수가 지킨다).
-- - `ext`(소문자 확장자) 열을 더했다 — SQLite에는 정규식이 없다(설계 §4).
-- - pgroonga 색인·FTS5 가상 표는 만들지 않는다. 검색은 instr(lower(…))다(§8-3: FTS5 그림자 표는 db:parity·
--   표 개수 테스트·drizzle-kit push와 부딪힌다).
-- - 원본 RLS(attachment_texts_select)·RPC(search_attachment_texts·attachments_pending_extraction)는 옮기지 않았다.
--   읽기 범위·삭제된 메시지 제외는 `src/db/queries/work/search.ts`의 WHERE가, 추출 대상 고르기는
--   `src/db/queries/work/texts.ts`가 한다. 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
--
-- DDL은 `src/db/schema/work.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- BEGIN/COMMIT은 0018·0027과 같은 이유다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;

CREATE TABLE `work_attachment_texts` (
	`attachment_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`ext` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`extractor_version` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`extracted_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `work_attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `work_attachment_texts_channel_idx` ON `work_attachment_texts` (`channel_id`);
CREATE INDEX `work_attachment_texts_failed_idx` ON `work_attachment_texts` (`extracted_at`) WHERE "status" = 'failed';

COMMIT;
