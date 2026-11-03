-- 이사회 업무툴 5단계 — 웹 푸시 구독·메일 다이제스트 상태·크론 실행 장부(kosmart-work 이식).
-- 설계: docs/board-work/01-설계.md §4·§8-4·§8-5.
--
-- 원본은 kosmart-work Postgres `work.push_subscriptions`(0001·0008·0033), `work.digest_state`(0005),
-- `work.cron_runs`(0042)다. 옮기면서:
-- - 0027과 같은 규칙: `work_` 접두사, 사람 FK는 `member_profiles`, CHECK 없음.
-- - 원본 harden_push_subscriptions_write(user_id 강제)와 RLS·권한 회수(0033 A3)는 **옮기지 않았다.** 구독 쓰기는
--   `/api/board-room/work/push/*` 라우트만 하고, 쓰기 함수(`src/db/queries/work/push.ts`)가 user_id를 인자로만 받는다.
--   다른 사람 것인 endpoint 등록 거부(409)도 라우트가 한다. 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
-- - 원본 RPC `push_recipients`·`digest_candidates`·`in_quiet_hours`는 SQL 함수가 아니라
--   `src/db/queries/work/push.ts`·`digest.ts`와 `src/work/lib/notifications/quiet-hours.ts`(TS)로 옮겼다.
-- - 번호: 4단계(본문 추출·검색)가 0031을 쓴다. 이 파일은 0032다(main의 0026_timebank 뒤로 한 칸 미뤘다).
--
-- DDL은 `src/db/schema/workPush.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- BEGIN/COMMIT은 0018·0027과 같은 이유다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;

CREATE TABLE `work_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `work_push_subscriptions_endpoint_key` ON `work_push_subscriptions` (`endpoint`);
CREATE INDEX `work_push_subscriptions_user_idx` ON `work_push_subscriptions` (`user_id`);
CREATE INDEX `work_push_subscriptions_last_seen_idx` ON `work_push_subscriptions` (`last_seen_at`);

CREATE TABLE `work_digest_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_sent_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `work_cron_runs` (
	`job` text PRIMARY KEY NOT NULL,
	`last_started_at` integer,
	`last_succeeded_at` integer,
	`last_status` text DEFAULT 'running' NOT NULL
);

COMMIT;
