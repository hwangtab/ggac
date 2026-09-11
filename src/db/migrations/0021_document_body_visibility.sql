-- board_documents에 웹 본문과 열람 범위를 더한다.
--
-- 기존 행은 전부 visibility='board'로 떨어진다. 이 마이그레이션만으로는
-- 아무것도 새로 열리지 않는다 — 지금 보던 사람에게만 계속 보인다.
--
-- SQLite는 ADD COLUMN에 CHECK를 붙일 수 없다. 값 검증은 쓰기 경로가 맡고
-- (documents POST, 수입 스크립트), 회귀는 documentVisibility.test.mjs가 본다.
BEGIN;
--> statement-breakpoint
ALTER TABLE `board_documents` ADD COLUMN `body_markdown` text;
--> statement-breakpoint
ALTER TABLE `board_documents` ADD COLUMN `visibility` text DEFAULT 'board' NOT NULL;
--> statement-breakpoint
COMMIT;
