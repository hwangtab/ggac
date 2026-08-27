import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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

export const boardMeetings = sqliteTable('board_meetings', {
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
})

export const boardAgendas = sqliteTable('board_agendas', {
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
})

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

export const boardDocuments = sqliteTable('board_documents', {
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
})

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

export const boardMeetingDateOptions = sqliteTable('board_meeting_date_options', {
  id: uuidPk(),
  meetingId: text('meeting_id')
    .notNull()
    .references(() => boardMeetings.id, { onDelete: 'cascade' }),
  /** date 전용: 'YYYY-MM-DD' */
  candidateDate: text('candidate_date').notNull(),
})

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
