import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

export const boardMeetings = sqliteTable('board_meetings', {
  id: uuidPk(),
  title: text('title').notNull(),
  /** date 전용: 'YYYY-MM-DD' */
  meetingDate: text('meeting_date'),
  location: text('location'),
  status: text('status').notNull().default('polling'),
  voteDeadline: integer('vote_deadline', { mode: 'timestamp_ms' }),
  createdBy: text('created_by').references(() => memberProfiles.id),
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
  proposedBy: text('proposed_by').references(() => memberProfiles.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const boardMinutes = sqliteTable('board_minutes', {
  id: uuidPk(),
  meetingId: text('meeting_id')
    .notNull()
    .references(() => boardMeetings.id, { onDelete: 'cascade' }),
  content: text('content'),
  contentFormat: text('content_format'),
  authorId: text('author_id').references(() => memberProfiles.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const boardDocuments = sqliteTable('board_documents', {
  id: uuidPk(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  /** Blob 비공개 저장소의 pathname. 인증된 라우트가 스트리밍으로만 노출한다. */
  filePath: text('file_path').notNull(),
  fileName: text('file_name'),
  fileSize: integer('file_size'),
  mimeType: text('mime_type'),
  uploadedBy: text('uploaded_by').references(() => memberProfiles.id),
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
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
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
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex('board_meeting_date_votes_option_voter_idx').on(table.optionId, table.voterId),
  ]
)
