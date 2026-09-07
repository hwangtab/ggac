-- 에디터 업로드 원장(`media_uploads`).
--
-- 왜 표를 더하는가: `/api/media/upload` POST는 Blob에 올리고 URL만 돌려줬다.
-- 어떤 표에도 참조가 남지 않아, 에디터에 삽입되지 않은 업로드는 **추적할
-- 수단 자체가 없는 영구 고아**가 됐다. 이 표가 "올라왔다"는 사실을 기록하면
-- 정리 크론(`/api/internal/uploads/cleanup`)이 "올라왔지만 아무 게시글도
-- 참조하지 않는 파일"을 골라 지울 수 있다.
--
-- created_at·updated_at의 DEFAULT: 스키마 쪽(`_shared.ts`)은 `$defaultFn`으로
-- Drizzle이 값을 채우므로 SQL DEFAULT가 없다. 그러면 **Drizzle을 거치지 않는
-- 쓰기**(백필 마이그레이션·turso 셸·복구 스크립트)가 NOT NULL로 죽는다.
-- `user`/`session` 등 auth 표들이 이미 같은 이유로 이 DEFAULT를 갖고 있어서,
-- 새로 만드는 이 표는 처음부터 갖고 시작한다.
--
-- user_id는 ON DELETE SET NULL이다. cascade면 회원 삭제와 함께 기록이 사라져
-- Blob에만 파일이 남는 고아가 다시 생긴다 — 이 표가 없애려는 바로 그 상태다.
--
-- 인덱스 이름에 `idx_` 접두사를 쓰지 않는 이유: 그 접두사는
-- `performanceIndexDeclarations.test.mjs`가 0004·0005·0017만 정본으로 보고
-- 대조하는 이름 공간이다. 0016·0017의 예매 인덱스와 같이 표 이름 접두사를 쓴다.
--
-- BEGIN/COMMIT: 0013~0017과 같은 이유 — 이 저장소는 파일을 통째로
-- executeMultiple()로 적용하며 그 함수는 문마다 자동 커밋한다. 감싸지 않으면
-- 중간 실패가 반쪽 상태로 남고 재실행으로 복구되지 않는다.
BEGIN;

CREATE TABLE `media_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`bucket` text NOT NULL,
	`path` text NOT NULL,
	`url` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `media_uploads_url_unique` ON `media_uploads` (`url`);

CREATE INDEX `media_uploads_user_idx` ON `media_uploads` (`user_id`);

CREATE INDEX `media_uploads_created_idx` ON `media_uploads` (`created_at`);

COMMIT;
