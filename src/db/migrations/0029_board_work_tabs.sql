-- 이사회 업무툴 2단계 — 대화 탭·메모·할 일(kosmart-work 이식). 설계: docs/board-work/01-설계.md §4·§5·§6.
--
-- 원본은 kosmart-work Postgres `work.conversation_tabs`(0023·0025·0026·0033), `work.conversation_notes`·
-- `work.conversation_note_revisions`(0024·0039), `work.tasks`(0006·0036)다. 옮기면서:
-- - 0027과 같은 규칙: `work_` 접두사, 사람 FK는 `member_profiles`, enum·CHECK 없음(허용값·길이는 zod와 쓰기 함수).
-- - 원본의 RLS·BEFORE/AFTER 트리거는 **옮기지 않았다.** 탭 하드닝(제목 trim·대화당 20개·position max+1·
--   https만·첨부/메모는 같은 대화의 것만)·메모 하드닝(대화당 30개·바뀐 저장만 version+1)·개정 기록(최근 200개)·
--   메모 탭을 지우면 메모도 지움·할 일 하드닝(작성자 강제·완료 시각/완료자)은 `src/db/queries/work/{tabs,notes,tasks}.ts`
--   쓰기 함수가 같은 트랜잭션에서 지킨다. 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
-- - 할 일 탭 1개·같은 메모를 두 탭이 가리키지 않기는 부분 유일 인덱스로 DB에도 둔다(원본과 같다).
-- - 작성자 FK는 원본(`not null … cascade`)과 달리 `set null`이다 — workTabs.ts 머리말.
-- - 원본 'wiki'·'timeline' 탭 종류는 가져오지 않았다.
--
-- DDL은 `src/db/schema/workTabs.ts`를 drizzle-kit push로 빈 로컬 DB에 밀어 넣고 sqlite_master에서 그대로 옮겼다.
-- BEGIN/COMMIT은 0018·0027과 같은 이유다(drizzle-kit migrate 금지 — scripts/turso/README.md).
BEGIN;

CREATE TABLE `work_conversation_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `work_conversation_tabs_channel_idx` ON `work_conversation_tabs` (`channel_id`,`position`,`created_at`);
CREATE INDEX `work_conversation_tabs_created_by_idx` ON `work_conversation_tabs` (`created_by`);
CREATE UNIQUE INDEX `work_conversation_tabs_one_tasks_idx` ON `work_conversation_tabs` (`channel_id`) WHERE "kind" = 'tasks';
CREATE UNIQUE INDEX `work_conversation_tabs_one_note_idx` ON `work_conversation_tabs` (("config" ->> '$.noteId')) WHERE "kind" = 'note';

CREATE TABLE `work_conversation_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`title` text,
	`body` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `work_conversation_notes_channel_idx` ON `work_conversation_notes` (`channel_id`,`created_at`);
CREATE INDEX `work_conversation_notes_updated_by_idx` ON `work_conversation_notes` (`updated_by`);

CREATE TABLE `work_note_revisions` (
	`note_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`edited_by` text,
	`edited_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`note_id`, `version`),
	FOREIGN KEY (`note_id`) REFERENCES `work_conversation_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edited_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `work_note_revisions_edited_by_idx` ON `work_note_revisions` (`edited_by`);

CREATE TABLE `work_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`title` text NOT NULL,
	`note` text,
	`assignee_id` text,
	`due_on` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text,
	`completed_at` integer,
	`completed_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `work_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `work_messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`completed_by`) REFERENCES `member_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `work_tasks_assignee_status_idx` ON `work_tasks` (`assignee_id`,`status`);
CREATE INDEX `work_tasks_channel_status_due_idx` ON `work_tasks` (`channel_id`,`status`,`due_on`);
CREATE INDEX `work_tasks_created_by_idx` ON `work_tasks` (`created_by`);
CREATE INDEX `work_tasks_message_idx` ON `work_tasks` (`message_id`);

COMMIT;
