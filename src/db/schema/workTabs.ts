// src/db/schema/workTabs.ts
import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, nowMs, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'
import { workChannels, workMessages } from './work.ts'

/**
 * 이사회 업무툴 2단계 — 대화 탭·메모·할 일. 원본은 kosmart-work `work.conversation_tabs`(0023·0025·0026·0033),
 * `work.conversation_notes`·`work.conversation_note_revisions`(0024·0039), `work.tasks`(0006·0036)다
 * (docs/board-work/01-설계.md §4).
 *
 * 1단계(`work.ts`)와 같은 규칙으로 옮겼다: enum·CHECK는 DB에 두지 않고, 원본 RLS·BEFORE/AFTER 트리거
 * (`harden_conversation_tabs_write`·`harden_conversation_notes_write`·`record_conversation_note_revision`·
 * `delete_note_with_tab`·`harden_tasks_write`)는 **하나도 옮겨지지 않았다.** 그 규칙은 `src/db/queries/work/
 * {tabs,notes,tasks}.ts`의 쓰기 함수가 같은 트랜잭션 안에서 지킨다(§5). 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
 *
 * 원본과 다른 점:
 * - 사람 FK(`created_by`·`updated_by`·`assignee_id`·`completed_by`)는 `member_profiles`에 `set null`로 건다.
 *   원본 `conversation_tabs.created_by`·`tasks.created_by`는 `not null … on delete cascade`였지만, 그러면 프로필이
 *   지워질 때 탭만 사라지고 메모가 남는다(원본은 AFTER DELETE 트리거가 메모를 함께 지웠다 — SQLite FK 연쇄 삭제는
 *   그 일을 하지 않는다). 대화 공용 탭·할 일은 만든 사람이 떠나도 남긴다(설계 §4 "작성자 FK는 set null").
 * - 실시간 브로드캐스트 트리거 대신 쓰기 함수가 `work_channels.tabs_rev`를 올린다(02-sync.md §1).
 * - 메모 검색 색인(pgroonga)은 4단계(검색)에서 다룬다.
 */

/**
 * 대화 상단 추가 탭. kind는 'file' | 'website' | 'tasks' | 'note' — 원본의 'wiki'·'timeline'은 가져오지 않았다.
 * config는 kind별 JSON 객체(4000바이트 이하): website `{url, embed}` · file `{attachmentId, history}` ·
 * note `{noteId}` · tasks `{}`.
 */
export const workConversationTabs = sqliteTable(
  'work_conversation_tabs',
  {
    id: uuidPk(),
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** 앞뒤 공백을 뗀 1~40자 */
    title: text('title').notNull(),
    /** 넣을 때 그 대화의 max+1(쓰기 함수가 정한다) */
    position: integer('position').notNull().default(0),
    config: text('config', { mode: 'json' })
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'`),
    createdBy: text('created_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('work_conversation_tabs_channel_idx').on(
      table.channelId,
      table.position,
      table.createdAt
    ),
    index('work_conversation_tabs_created_by_idx').on(table.createdBy),
    /** 원본 conversation_tabs_one_tasks_idx — 할 일 탭은 대화당 1개 */
    uniqueIndex('work_conversation_tabs_one_tasks_idx')
      .on(table.channelId)
      .where(sql`"kind" = 'tasks'`),
    /** 원본 conversation_tabs_one_note_idx — 같은 메모를 두 탭이 가리킬 수 없다 */
    uniqueIndex('work_conversation_tabs_one_note_idx')
      .on(sql`(${table.config} ->> '$.noteId')`)
      .where(sql`"kind" = 'note'`),
  ]
)

/** 대화 공용 메모(마크다운). 메모 탭(kind 'note', config.noteId)이 가리킨다 */
export const workConversationNotes = sqliteTable(
  'work_conversation_notes',
  {
    id: uuidPk(),
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    /** null 또는 앞뒤 공백을 뗀 1~80자 */
    title: text('title'),
    /** 10만 자 이하 */
    body: text('body').notNull().default(''),
    /** 제목·본문이 바뀐 저장마다 1 오른다(낙관적 잠금) — 쓰기 함수만 정한다 */
    version: integer('version').notNull().default(1),
    updatedBy: text('updated_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** 바뀐 게 없는 저장은 그대로 둔다 — 그래서 공용 `updatedAt()`(`$onUpdate`)을 쓰지 않는다 */
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowMs())
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  table => [
    index('work_conversation_notes_channel_idx').on(table.channelId, table.createdAt),
    index('work_conversation_notes_updated_by_idx').on(table.updatedBy),
  ]
)

/** 메모 저장 이력(version별 본문). 쓰기 함수만 넣는다. 메모당 최근 200개 */
export const workNoteRevisions = sqliteTable(
  'work_note_revisions',
  {
    noteId: text('note_id')
      .notNull()
      .references(() => workConversationNotes.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title'),
    body: text('body').notNull(),
    editedBy: text('edited_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    editedAt: integer('edited_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowMs())
      .$defaultFn(() => new Date()),
  },
  table => [
    primaryKey({ columns: [table.noteId, table.version] }),
    index('work_note_revisions_edited_by_idx').on(table.editedBy),
  ]
)

/** 가벼운 할 일 — 채널 소속, 원본 메시지 선택 */
export const workTasks = sqliteTable(
  'work_tasks',
  {
    id: uuidPk(),
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    /** 같은 채널의 메시지만(쓰기 함수가 지킨다) */
    messageId: text('message_id').references(() => workMessages.id, { onDelete: 'set null' }),
    /** 1~200자 */
    title: text('title').notNull(),
    /** 2000자 이하 */
    note: text('note'),
    assigneeId: text('assignee_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** 'YYYY-MM-DD'(원본 date) */
    dueOn: text('due_on'),
    /** 'open' | 'done' */
    status: text('status').notNull().default('open'),
    createdBy: text('created_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** status 전이로만 정해진다(원본 harden_tasks_write) */
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    completedBy: text('completed_by').references(() => memberProfiles.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('work_tasks_assignee_status_idx').on(table.assigneeId, table.status),
    index('work_tasks_channel_status_due_idx').on(table.channelId, table.status, table.dueOn),
    index('work_tasks_created_by_idx').on(table.createdBy),
    index('work_tasks_message_idx').on(table.messageId),
  ]
)
