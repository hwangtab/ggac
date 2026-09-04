import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

/**
 * 제약의 정본은 Postgres 원본
 * `supabase/migrations/20260529090020_create_board_room_tables.sql`이다.
 * 전환 초기 스키마(`0000_dizzy_krista_starr.sql`)에서 아래 7개가 어긋났고
 * 단계 4 Task 6a(`0002_restore_board_constraints.sql`)에서 되돌렸다.
 *
 * - `board_minutes.meeting_id` UNIQUE — 원본은 컬럼 선언에 UNIQUE가 있었다.
 *   유실되면 "회의당 회의록 1건"이 라우트의 check-then-insert(TOCTOU)에만
 *   기대게 되고, 중복이 생기면 `ORDER BY` 없는 `limit(1)` 때문에 임의의 한
 *   건만 보이고 나머지는 화면에서 보이지도 지워지지도 않는다.
 * - `member_profiles`를 가리키는 FK 6개의 `ON DELETE`. 원본은
 *   작성자/제안자/업로더 4개가 `SET NULL`(기록은 남기고 사람만 지운다),
 *   출석·일정투표 2개가 NO ACTION(기록이 있으면 회원 삭제 자체를 막는다)다.
 *   특히 출석은 **정족수 계산의 원천 데이터**라 `cascade`로 지워지면 과거
 *   이사회의 정족수가 소급해 바뀐다.
 *
 * `board_meetings`를 가리키는 FK 4개의 `ON DELETE CASCADE`는 원본과 같다.
 */

export const boardMeetings = sqliteTable(
  'board_meetings',
  {
    id: uuidPk(),
    title: text('title').notNull(),
    /** date 전용: 'YYYY-MM-DD' */
    meetingDate: text('meeting_date'),
    /**
     * time 전용: 'HH:MM'(24시간). NULL이면 `DEFAULT_BOARD_MEETING_TIME`(21:00).
     * 컷오버 이전에 만들어진 회의는 전부 NULL이고, 실제로도 21:00이었다.
     */
    meetingTime: text('meeting_time'),
    location: text('location'),
    status: text('status').notNull().default('polling'),
    voteDeadline: integer('vote_deadline', { mode: 'timestamp_ms' }),
    createdBy: text('created_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    /**
     * 회의 목록이 `ORDER BY created_at DESC`로 돈다. 형제 표들은 전부 성능
     * 인덱스를 선언했는데 이 표만 하나도 없어 매번 전체 스캔 뒤 정렬이었다.
     */
    index('idx_board_meetings_created_at').on(table.createdAt),
  ]
)

export const boardAgendas = sqliteTable(
  'board_agendas',
  {
    id: uuidPk(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => boardMeetings.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('proposed'),
    proposedBy: text('proposed_by').references(() => memberProfiles.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_board_agendas_meeting').on(table.meetingId, table.sortOrder),
  ]
)

export const boardMinutes = sqliteTable(
  'board_minutes',
  {
    id: uuidPk(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => boardMeetings.id, { onDelete: 'cascade' }),
    content: text('content'),
    contentFormat: text('content_format'),
    authorId: text('author_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [uniqueIndex('board_minutes_meeting_id_idx').on(table.meetingId)]
)

export const boardDocuments = sqliteTable(
  'board_documents',
  {
    id: uuidPk(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    /** Blob 비공개 저장소의 pathname. 인증된 라우트가 스트리밍으로만 노출한다. */
    filePath: text('file_path').notNull(),
    fileName: text('file_name'),
    fileSize: integer('file_size'),
    mimeType: text('mime_type'),
    uploadedBy: text('uploaded_by').references(() => memberProfiles.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  table => [
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_board_documents_category').on(table.category, sql`\`created_at\` DESC`),
  ]
)

export const boardMeetingAttendees = sqliteTable(
  'board_meeting_attendees',
  {
    id: uuidPk(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => boardMeetings.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => memberProfiles.id),
    attended: integer('attended', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex('board_meeting_attendees_meeting_member_idx').on(table.meetingId, table.memberId),
  ]
)

export const boardMeetingDateOptions = sqliteTable(
  'board_meeting_date_options',
  {
    id: uuidPk(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => boardMeetings.id, { onDelete: 'cascade' }),
    /** date 전용: 'YYYY-MM-DD' */
    candidateDate: text('candidate_date').notNull(),
  },
  table => [
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_board_date_options_meeting').on(table.meetingId, table.candidateDate),
  ]
)

export const boardMeetingDateVotes = sqliteTable(
  'board_meeting_date_votes',
  {
    id: uuidPk(),
    optionId: text('option_id')
      .notNull()
      .references(() => boardMeetingDateOptions.id, { onDelete: 'cascade' }),
    voterId: text('voter_id')
      .notNull()
      .references(() => memberProfiles.id),
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex('board_meeting_date_votes_option_voter_idx').on(table.optionId, table.voterId),
  ]
)

/**
 * 안건별 토론 댓글. 회의를 지우면 안건과 함께 cascade로 사라진다.
 *
 * `author_id`는 NOT NULL + NO ACTION이다(게시판 `comments`와 동일). 이사회
 * 발언은 회의록의 근거라 작성자를 지운 익명 기록으로 남기지 않는다 — 댓글이
 * 있으면 회원 삭제 자체가 막힌다. 삭제는 `is_deleted` soft delete로만 하고
 * 본문은 라우트가 마스킹해 API 응답에도 싣지 않는다.
 */
export const boardAgendaComments = sqliteTable(
  'board_agenda_comments',
  {
    id: uuidPk(),
    agendaId: text('agenda_id')
      .notNull()
      .references(() => boardAgendas.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => memberProfiles.id),
    content: text('content').notNull(),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [index('board_agenda_comments_agenda_created_idx').on(table.agendaId, table.createdAt)]
)
