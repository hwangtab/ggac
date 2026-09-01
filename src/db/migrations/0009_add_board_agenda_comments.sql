-- ⚠ **적용은 파일을 통째로 실행하는 경로로만 한다**(`executeMultiple`).
-- `drizzle-kit migrate`는 쓰지 않는다 — 이 저장소의 규약이고, 마이그레이터가
-- 자체 트랜잭션으로 감싸면 아래 `BEGIN`이 즉시 실패한다.
--
-- **왜 BEGIN/COMMIT이 붙었나.** 원래 이 파일에는 트랜잭션이 없었다. 그런데
-- `executeMultiple()`은 **문마다 자동 커밋**하므로 중간에 한 문이 실패하면
-- 앞 문들이 그대로 남는다. 그 반쪽 상태는 재실행으로 복구되지 않는다 —
-- 실측(2026-09-01): 두 번째 표가 이미 있는 DB에 이 파일을 적용하면 첫 표만
-- 만들어진 채 실패하고, 다시 돌리면 이번엔 그 첫 표 때문에 실패해 **손으로
-- DROP하기 전까지 영구 교착**이었다.
--
-- 이제 실패하면 전체가 롤백되어 아무것도 남지 않는다(= 그냥 다시 돌리면 된다).
BEGIN;
--> statement-breakpoint
CREATE TABLE `board_agenda_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`agenda_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agenda_id`) REFERENCES `board_agendas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `board_agenda_comments_agenda_created_idx` ON `board_agenda_comments` (`agenda_id`,`created_at`);
--> statement-breakpoint
COMMIT;
