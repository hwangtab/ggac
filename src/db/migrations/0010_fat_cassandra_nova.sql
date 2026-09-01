-- 지원사업 주간 회차(grant_digests).
--
-- BEGIN/COMMIT으로 감싸는 이유: 이 저장소는 `drizzle-kit migrate`를 쓰지 않고 파일을
-- 통째로 `executeMultiple()`로 적용하는데, 그 함수는 **문마다 자동 커밋**한다. 감싸지
-- 않으면 인덱스 생성에서 실패했을 때 표만 남고, 재실행하면 그 표 때문에 또 실패해
-- 손으로 DROP하기 전까지 교착된다(scripts/testing/migrationAtomicity.test.mjs).
BEGIN;
CREATE TABLE `grant_digests` (
	`id` text PRIMARY KEY NOT NULL,
	`week_key` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`post_id` text,
	`created_at` integer NOT NULL,
	`published_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grant_digests_week_key_idx` ON `grant_digests` (`week_key`);
COMMIT;
