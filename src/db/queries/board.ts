/**
 * `board_meetings` · `board_agendas` · `board_minutes` · `board_documents` ·
 * `board_meeting_attendees` · `board_meeting_date_options` ·
 * `board_meeting_date_votes` 쿼리 계층 (Turso/Drizzle). 단계 4 Task 4.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 이사회 권한 판정
 * (`requireBoardMember()`/`requireBoardAdmin()`, `doc.uploaded_by !==
 * user.id && !isAdmin` 같은 소유권 검사)은 전부 호출부
 * (`src/app/api/board-room/*`)의 몫이고 이 파일은 건드리지 않는다 —
 * **이사회 서류 다운로드는 매 요청마다 `requireBoardMember()`를 다시
 * 통과해야 한다**(서명 URL을 쓰지 않는 이유가
 * `src/app/api/board-room/documents/[id]/download/route.ts`의 주석에
 * 있다). 이 모듈의 함수는 그 재검증 뒤에만 호출된다는 전제로 설계됐다.
 *
 * 응답 형태는 snake_case다(CLAUDE.md).
 *
 * `board_*` 테이블에는 Postgres 트리거가 `updated_at = NOW()` 자동 갱신
 * 하나뿐이었다(`20260529090020_create_board_room_tables.sql`의 범용
 * `update_updated_at_column()`) — `src/db/schema/board.ts`의 `updatedAt()`
 * 공유 헬퍼가 Drizzle `$onUpdate`로 이미 재현한다. 그 외 트리거는 없다.
 */

import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  boardAgendas,
  boardDocuments,
  boardMeetingAttendees,
  boardMeetingDateOptions,
  boardMeetingDateVotes,
  boardMeetings,
  boardMinutes,
} from '../schema/index.ts'

import { toIso } from './_helpers.ts'

// -------------------------------------------------------------------------
// board_meetings
// -------------------------------------------------------------------------

export interface MeetingRow {
  id: string
  title: string
  meeting_date: string | null
  location: string | null
  status: string
  vote_deadline: string | null
  created_at: string
}

function rowToMeeting(row: typeof boardMeetings.$inferSelect): MeetingRow {
  return {
    id: row.id,
    title: row.title,
    meeting_date: row.meetingDate,
    location: row.location,
    status: row.status,
    vote_deadline: toIso(row.voteDeadline),
    created_at: toIso(row.createdAt) as string,
  }
}

/** `/api/board-room/meetings` GET. `created_at` 내림차순은 원본과 동일. */
export async function listMeetings(): Promise<MeetingRow[]> {
  const rows = await db.select().from(boardMeetings).orderBy(desc(boardMeetings.createdAt))
  return rows.map(rowToMeeting)
}

/** `/api/board-room/meetings/[id]` GET. */
export async function getMeetingById(id: string): Promise<MeetingRow | null> {
  const [row] = await db.select().from(boardMeetings).where(eq(boardMeetings.id, id)).limit(1)
  return row ? rowToMeeting(row) : null
}

/** 알림 메시지에 쓰는 회의 제목만. 여러 라우트(minutes/agendas 생성 후 알림)가 쓴다. */
export async function getMeetingTitle(id: string): Promise<string | null> {
  const [row] = await db
    .select({ title: boardMeetings.title })
    .from(boardMeetings)
    .where(eq(boardMeetings.id, id))
    .limit(1)
  return row?.title ?? null
}

export interface CreateMeetingInput {
  title: string
  location: string | null
  voteDeadline: Date
  createdBy: string
}

/** `/api/board-room/meetings` POST. `status: 'polling'`으로 시작(원본과 동일). */
export async function createMeeting(input: CreateMeetingInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(boardMeetings)
    .values({
      title: input.title,
      location: input.location,
      status: 'polling',
      voteDeadline: input.voteDeadline,
      createdBy: input.createdBy,
    })
    .returning({ id: boardMeetings.id })
  return row
}

export interface MeetingUpdatePatch {
  title?: string
  location?: string | null
  voteDeadline?: Date | null
  meetingDate?: string
  status?: string
}

/**
 * `/api/board-room/meetings/[id]` PATCH. 호출부가 이미 조건별로 조립한
 * 갱신 필드만 받는다(제목/장소/투표마감일/확정날짜+상태/완료 상태) —
 * 어떤 필드를 언제 같이 보낼지의 판단은 라우트에 남아 있다.
 * @returns 대상이 없으면 `null`.
 */
export async function updateMeeting(
  id: string,
  patch: MeetingUpdatePatch
): Promise<{ title: string; meeting_date: string | null } | null> {
  const [row] = await db
    .update(boardMeetings)
    .set(patch)
    .where(eq(boardMeetings.id, id))
    .returning({ title: boardMeetings.title, meetingDate: boardMeetings.meetingDate })
  return row ? { title: row.title, meeting_date: row.meetingDate } : null
}

/** `/api/board-room/meetings` POST의 롤백, `/api/board-room/meetings/[id]` DELETE. */
export async function deleteMeeting(id: string): Promise<void> {
  await db.delete(boardMeetings).where(eq(boardMeetings.id, id))
}

// -------------------------------------------------------------------------
// board_meeting_date_options / board_meeting_date_votes
// -------------------------------------------------------------------------

export interface DateOptionRow {
  id: string
  candidate_date: string
}

/** `/api/board-room/meetings/[id]` GET. `candidate_date` 오름차순은 원본과 동일. */
export async function listDateOptions(meetingId: string): Promise<DateOptionRow[]> {
  const rows = await db
    .select({
      id: boardMeetingDateOptions.id,
      candidateDate: boardMeetingDateOptions.candidateDate,
    })
    .from(boardMeetingDateOptions)
    .where(eq(boardMeetingDateOptions.meetingId, meetingId))
    .orderBy(asc(boardMeetingDateOptions.candidateDate))
  return rows.map(row => ({ id: row.id, candidate_date: row.candidateDate }))
}

/** `/api/board-room/meetings` POST. */
export async function createDateOptions(
  meetingId: string,
  candidateDates: string[]
): Promise<void> {
  if (candidateDates.length === 0) return
  await db
    .insert(boardMeetingDateOptions)
    .values(candidateDates.map(candidateDate => ({ meetingId, candidateDate })))
}

/** `/api/board-room/date-votes` PUT의 후보 날짜 존재 확인. */
export async function getDateOptionMeetingId(
  optionId: string
): Promise<{ id: string; meeting_id: string } | null> {
  const [row] = await db
    .select({ id: boardMeetingDateOptions.id, meetingId: boardMeetingDateOptions.meetingId })
    .from(boardMeetingDateOptions)
    .where(eq(boardMeetingDateOptions.id, optionId))
    .limit(1)
  return row ? { id: row.id, meeting_id: row.meetingId } : null
}

/** `/api/board-room/meetings/[id]` PATCH의 확정 날짜 검증(후보에 있는 날짜인가). */
export async function getDateOptionByMeetingAndDate(
  meetingId: string,
  candidateDate: string
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: boardMeetingDateOptions.id })
    .from(boardMeetingDateOptions)
    .where(
      and(
        eq(boardMeetingDateOptions.meetingId, meetingId),
        eq(boardMeetingDateOptions.candidateDate, candidateDate)
      )
    )
    .limit(1)
  return row ?? null
}

/** `/api/board-room/date-votes` PUT의 회의 투표 상태 확인용. */
export async function getMeetingVotingState(
  meetingId: string
): Promise<{ status: string; vote_deadline: string | null } | null> {
  const [row] = await db
    .select({ status: boardMeetings.status, voteDeadline: boardMeetings.voteDeadline })
    .from(boardMeetings)
    .where(eq(boardMeetings.id, meetingId))
    .limit(1)
  return row ? { status: row.status, vote_deadline: toIso(row.voteDeadline) } : null
}

export interface DateVoteRow {
  option_id: string
  voter_id: string
  is_available: boolean
}

/** `/api/board-room/meetings/[id]` GET. */
export async function listDateVotesByOptionIds(optionIds: string[]): Promise<DateVoteRow[]> {
  if (optionIds.length === 0) return []
  const rows = await db
    .select({
      optionId: boardMeetingDateVotes.optionId,
      voterId: boardMeetingDateVotes.voterId,
      isAvailable: boardMeetingDateVotes.isAvailable,
    })
    .from(boardMeetingDateVotes)
    .where(inArray(boardMeetingDateVotes.optionId, optionIds))
  return rows.map(row => ({
    option_id: row.optionId,
    voter_id: row.voterId,
    is_available: row.isAvailable,
  }))
}

/**
 * `/api/board-room/date-votes` PUT. `board_meeting_date_votes_option_voter_idx`
 * (option_id, voter_id) 충돌 시 가용 여부만 갱신한다.
 */
export async function upsertDateVote(
  optionId: string,
  voterId: string,
  isAvailable: boolean
): Promise<void> {
  await db
    .insert(boardMeetingDateVotes)
    .values({ optionId, voterId, isAvailable })
    .onConflictDoUpdate({
      target: [boardMeetingDateVotes.optionId, boardMeetingDateVotes.voterId],
      set: { isAvailable, updatedAt: new Date() },
    })
}

// -------------------------------------------------------------------------
// board_meeting_attendees
// -------------------------------------------------------------------------

export interface AttendeeRow {
  member_id: string
  attended: boolean
}

/** `/api/board-room/attendees` GET, `/api/board-room/meetings/[id]` GET. */
export async function listMeetingAttendees(meetingId: string): Promise<AttendeeRow[]> {
  const rows = await db
    .select({ memberId: boardMeetingAttendees.memberId, attended: boardMeetingAttendees.attended })
    .from(boardMeetingAttendees)
    .where(eq(boardMeetingAttendees.meetingId, meetingId))
  return rows.map(row => ({ member_id: row.memberId, attended: row.attended }))
}

/**
 * `/api/board-room/attendees` PUT. `board_meeting_attendees_meeting_member_idx`
 * (meeting_id, member_id) 충돌 시 출석 여부만 갱신한다 — 원본의
 * `.upsert(rows, {onConflict:'meeting_id,member_id'})`와 동일.
 */
export async function upsertMeetingAttendees(
  meetingId: string,
  records: { member_id: string; attended: boolean }[]
): Promise<void> {
  if (records.length === 0) return
  await db
    .insert(boardMeetingAttendees)
    .values(records.map(r => ({ meetingId, memberId: r.member_id, attended: r.attended })))
    .onConflictDoUpdate({
      target: [boardMeetingAttendees.meetingId, boardMeetingAttendees.memberId],
      // 다건 INSERT의 각 충돌 행마다 그 행 자신의 값을 반영해야 하므로
      // 고정값이 아니라 SQLite의 `excluded` 의사 테이블을 참조한다(활동로그
      // 배치 upsert에서 쓴 것과 같은 패턴 — activities.ts 참고).
      set: { attended: sql`excluded.attended`, updatedAt: new Date() },
    })
}

// -------------------------------------------------------------------------
// board_agendas
// -------------------------------------------------------------------------

export interface AgendaRow {
  id: string
  meeting_id: string
  title: string
  content: string | null
  sort_order: number
  status: string
  proposed_by: string | null
  created_at: string
}

function rowToAgenda(row: typeof boardAgendas.$inferSelect): AgendaRow {
  return {
    id: row.id,
    meeting_id: row.meetingId,
    title: row.title,
    content: row.content,
    sort_order: row.sortOrder,
    status: row.status,
    proposed_by: row.proposedBy,
    created_at: toIso(row.createdAt) as string,
  }
}

/** `/api/board-room/meetings/[id]` GET. `sort_order` 오름차순은 원본과 동일. */
export async function listAgendasByMeeting(meetingId: string): Promise<AgendaRow[]> {
  const rows = await db
    .select()
    .from(boardAgendas)
    .where(eq(boardAgendas.meetingId, meetingId))
    .orderBy(asc(boardAgendas.sortOrder))
  return rows.map(rowToAgenda)
}

/** `/api/board-room/agendas` POST의 다음 순서 계산. */
export async function getLastAgendaSortOrder(meetingId: string): Promise<number | null> {
  const [row] = await db
    .select({ sortOrder: boardAgendas.sortOrder })
    .from(boardAgendas)
    .where(eq(boardAgendas.meetingId, meetingId))
    .orderBy(desc(boardAgendas.sortOrder))
    .limit(1)
  return row?.sortOrder ?? null
}

export interface CreateAgendaInput {
  meetingId: string
  title: string
  content: string | null
  sortOrder: number
  proposedBy: string
}

/** `/api/board-room/agendas` POST. `status: 'proposed'`으로 시작(원본과 동일). */
export async function createAgenda(input: CreateAgendaInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(boardAgendas)
    .values({
      meetingId: input.meetingId,
      title: input.title,
      content: input.content,
      sortOrder: input.sortOrder,
      status: 'proposed',
      proposedBy: input.proposedBy,
    })
    .returning({ id: boardAgendas.id })
  return row
}

/**
 * `/api/board-room/agendas/[id]` PATCH/DELETE의 소유권 확인.
 * @returns 행이 없으면 `undefined`(404 대상), 행은 있지만 `proposed_by`가
 * NULL이면 `null`(소유자 없음 — 관리자만 수정/삭제 가능, 원본 Supabase
 * `.single()` 오류와 "행은 있으나 컬럼이 NULL"을 구분하던 것과 동일한
 * 계약이다). 이 둘을 합쳐 버리면 "없음"과 "주인 없음"을 못 가려 관리자도
 * 못 고치는 회귀가 생긴다(board_documents의 uploaded_by NULL 시드 문제와
 * 같은 종류).
 */
export async function getAgendaOwner(id: string): Promise<string | null | undefined> {
  const [row] = await db
    .select({ proposedBy: boardAgendas.proposedBy })
    .from(boardAgendas)
    .where(eq(boardAgendas.id, id))
    .limit(1)
  if (!row) return undefined
  return row.proposedBy
}

export interface AgendaUpdatePatch {
  title?: string
  content?: string | null
  status?: string
  sortOrder?: number
}

/** `/api/board-room/agendas/[id]` PATCH. */
export async function updateAgenda(id: string, patch: AgendaUpdatePatch): Promise<void> {
  await db
    .update(boardAgendas)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    })
    .where(eq(boardAgendas.id, id))
}

/** `/api/board-room/agendas/[id]` DELETE. */
export async function deleteAgenda(id: string): Promise<void> {
  await db.delete(boardAgendas).where(eq(boardAgendas.id, id))
}

// -------------------------------------------------------------------------
// board_minutes
// -------------------------------------------------------------------------

export interface MinutesRow {
  id: string
  content: string | null
  content_format: string | null
  author_id: string | null
  updated_at: string
}

/** `/api/board-room/minutes` POST의 중복 확인(회의당 회의록 1개). */
export async function getMinutesIdByMeetingId(meetingId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: boardMinutes.id })
    .from(boardMinutes)
    .where(eq(boardMinutes.meetingId, meetingId))
    .limit(1)
  return row?.id ?? null
}

/** `/api/board-room/meetings/[id]` GET. */
export async function getMinutesByMeetingId(meetingId: string): Promise<MinutesRow | null> {
  const [row] = await db
    .select()
    .from(boardMinutes)
    .where(eq(boardMinutes.meetingId, meetingId))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    content: row.content,
    content_format: row.contentFormat,
    author_id: row.authorId,
    updated_at: toIso(row.updatedAt) as string,
  }
}

export interface CreateMinutesInput {
  meetingId: string
  content: string
  contentFormat: string
  authorId: string
}

/** `/api/board-room/minutes` POST. */
export async function createMinutes(input: CreateMinutesInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(boardMinutes)
    .values({
      meetingId: input.meetingId,
      content: input.content,
      contentFormat: input.contentFormat,
      authorId: input.authorId,
    })
    .returning({ id: boardMinutes.id })
  return row
}

/** `/api/board-room/minutes/[id]` PATCH/DELETE의 소유권 확인. */
export async function getMinutesAuthorAndFormat(
  id: string
): Promise<{ author_id: string | null; content_format: string | null } | null> {
  const [row] = await db
    .select({ authorId: boardMinutes.authorId, contentFormat: boardMinutes.contentFormat })
    .from(boardMinutes)
    .where(eq(boardMinutes.id, id))
    .limit(1)
  if (!row) return null
  return { author_id: row.authorId, content_format: row.contentFormat }
}

export interface MinutesUpdatePatch {
  content?: string
  contentFormat?: string
}

/** `/api/board-room/minutes/[id]` PATCH. */
export async function updateMinutes(id: string, patch: MinutesUpdatePatch): Promise<void> {
  await db
    .update(boardMinutes)
    .set({
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.contentFormat !== undefined ? { contentFormat: patch.contentFormat } : {}),
    })
    .where(eq(boardMinutes.id, id))
}

/** `/api/board-room/minutes/[id]` DELETE. */
export async function deleteMinutes(id: string): Promise<void> {
  await db.delete(boardMinutes).where(eq(boardMinutes.id, id))
}

// -------------------------------------------------------------------------
// board_documents
// -------------------------------------------------------------------------

export interface DocumentRow {
  id: string
  title: string
  category: string
  file_path: string
  file_name: string | null
  file_size: number | null
  mime_type: string | null
  uploaded_by: string | null
  created_at: string
}

function rowToDocument(row: typeof boardDocuments.$inferSelect): DocumentRow {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    file_path: row.filePath,
    file_name: row.fileName,
    file_size: row.fileSize,
    mime_type: row.mimeType,
    uploaded_by: row.uploadedBy,
    created_at: toIso(row.createdAt) as string,
  }
}

/**
 * `/api/board-room/documents` GET. `category`가 있으면 그 값으로만 걸러진다.
 * 없으면 원본처럼 정기총회 자료(`assemblyDocumentCategory`)를 제외한
 * 일반 서류함 전체를 돌려준다.
 */
export async function listDocuments(filter: {
  category?: string | null
  excludeCategory?: string | null
}): Promise<DocumentRow[]> {
  const where = filter.category
    ? eq(boardDocuments.category, filter.category)
    : filter.excludeCategory
      ? ne(boardDocuments.category, filter.excludeCategory)
      : undefined

  const rows = await db
    .select()
    .from(boardDocuments)
    .where(where)
    .orderBy(desc(boardDocuments.createdAt))
  return rows.map(rowToDocument)
}

export interface CreateDocumentInput {
  title: string
  category: string
  filePath: string
  fileName: string
  fileSize: number
  mimeType: string
  uploadedBy: string
}

/** `/api/board-room/documents` POST. */
export async function createDocument(input: CreateDocumentInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(boardDocuments)
    .values({
      title: input.title,
      category: input.category,
      filePath: input.filePath,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      uploadedBy: input.uploadedBy,
    })
    .returning({ id: boardDocuments.id })
  return row
}

/** `/api/board-room/documents/[id]` DELETE의 소유권/경로 확인. */
export async function getDocumentForDelete(
  id: string
): Promise<{ uploaded_by: string | null; file_path: string } | null> {
  const [row] = await db
    .select({ uploadedBy: boardDocuments.uploadedBy, filePath: boardDocuments.filePath })
    .from(boardDocuments)
    .where(eq(boardDocuments.id, id))
    .limit(1)
  if (!row) return null
  return { uploaded_by: row.uploadedBy, file_path: row.filePath }
}

/** `/api/board-room/documents/[id]` DELETE. */
export async function deleteDocument(id: string): Promise<void> {
  await db.delete(boardDocuments).where(eq(boardDocuments.id, id))
}

/** `/api/board-room/documents/[id]/download` GET. */
export async function getDocumentForDownload(
  id: string
): Promise<{ file_path: string; file_name: string | null; mime_type: string | null } | null> {
  const [row] = await db
    .select({
      filePath: boardDocuments.filePath,
      fileName: boardDocuments.fileName,
      mimeType: boardDocuments.mimeType,
    })
    .from(boardDocuments)
    .where(eq(boardDocuments.id, id))
    .limit(1)
  if (!row) return null
  return { file_path: row.filePath, file_name: row.fileName, mime_type: row.mimeType }
}
