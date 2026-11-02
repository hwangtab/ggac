/**
 * 타임뱅크 게시판 쿼리 계층 — 글·댓글·조합 업무 자원 (스펙 §3·§6·§7.1).
 *
 * 장터(`market.ts`)와 같은 모양이고 같은 규칙을 따른다 — **권한을 모른다.**
 * 기능 스위치·동의·본인 여부·`coop_task`를 누가 만들 수 있는지는 전부 라우트가
 * 판정한다(`src/app/api/timebank/*`, 관리자 라우트). 여기서는 검증된 값만 받는다.
 *
 * - 삭제는 `is_deleted` soft delete다. 목록·상세·소유 조회는 삭제된 글을 돌려주지 않는다.
 * - 자원 기록은 (listing, member) UNIQUE라 멱등이다. 철회는 `withdrawn_at`을 찍고,
 *   다시 자원하면 null로 돌아온다(조합 업무 지급은 철회하지 않은 기록에만 한다, §6).
 *
 * 응답은 snake_case. 임포트는 상대경로 + `.ts`(`node --test`가 직접 import한다).
 */

import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  memberProfiles,
  timebankComments,
  timebankListings,
  timebankTaskVolunteers,
} from '../schema/index.ts'
import type {
  TimebankCategory,
  TimebankListingKind,
  TimebankListingStatus,
} from '../../constants/timebank.ts'

import { toIso } from './_helpers.ts'

// ── 글 ───────────────────────────────────────────────────────────────────────

export interface TimebankListingRow {
  id: string
  author_id: string
  author_name: string
  kind: TimebankListingKind
  category: TimebankCategory
  title: string
  description: string
  estimated_minutes: number | null
  status: TimebankListingStatus
  task_date: string | null
  comment_count: number
  /** 철회하지 않은 자원자 수. `coop_task`가 아니면 0. */
  volunteer_count: number
  created_at: string
  updated_at: string
}

/** 목록 카드용 — 본문은 싣지 않는다. */
export type TimebankListingSummary = Omit<TimebankListingRow, 'description'>

/** 쓰기 입력. `kind`의 허용 범위(조합원은 offer·request만)는 라우트가 정한다. */
export interface TimebankListingFields {
  kind: TimebankListingKind
  category: TimebankCategory
  title: string
  description: string
  estimated_minutes: number | null
  task_date?: string | null
}

const liveCommentCount = sql<number>`(
  SELECT count(*) FROM timebank_comments tc
  WHERE tc.listing_id = ${timebankListings.id} AND tc.is_deleted = 0
)`

const liveVolunteerCount = sql<number>`(
  SELECT count(*) FROM timebank_task_volunteers tv
  WHERE tv.listing_id = ${timebankListings.id} AND tv.withdrawn_at IS NULL
)`

const listingColumns = {
  id: timebankListings.id,
  authorId: timebankListings.authorId,
  authorName: memberProfiles.displayName,
  kind: timebankListings.kind,
  category: timebankListings.category,
  title: timebankListings.title,
  description: timebankListings.description,
  estimatedMinutes: timebankListings.estimatedMinutes,
  status: timebankListings.status,
  taskDate: timebankListings.taskDate,
  commentCount: liveCommentCount,
  volunteerCount: liveVolunteerCount,
  createdAt: timebankListings.createdAt,
  updatedAt: timebankListings.updatedAt,
}

type ListingSelectRow = { [K in keyof typeof listingColumns]: unknown }

function toListingRow(row: ListingSelectRow): TimebankListingRow {
  return {
    id: row.id as string,
    author_id: row.authorId as string,
    author_name: row.authorName as string,
    kind: row.kind as TimebankListingKind,
    category: row.category as TimebankCategory,
    title: row.title as string,
    description: row.description as string,
    estimated_minutes: (row.estimatedMinutes as number | null) ?? null,
    status: row.status as TimebankListingStatus,
    task_date: (row.taskDate as string | null) ?? null,
    comment_count: Number(row.commentCount ?? 0),
    volunteer_count: Number(row.volunteerCount ?? 0),
    created_at: toIso(row.createdAt as Date) as string,
    updated_at: toIso(row.updatedAt as Date) as string,
  }
}

export interface ListTimebankListingsFilter {
  kind?: TimebankListingKind
  category?: TimebankCategory
  status?: TimebankListingStatus
  authorId?: string
  offset: number
  limit: number
}

/** 최신순. 다음 페이지 유무를 알려고 `limit + 1`건을 읽는다. */
export async function listTimebankListings(
  filter: ListTimebankListingsFilter
): Promise<{ rows: TimebankListingSummary[]; hasNext: boolean }> {
  const conditions = [eq(timebankListings.isDeleted, false)]
  if (filter.kind) conditions.push(eq(timebankListings.kind, filter.kind))
  if (filter.category) conditions.push(eq(timebankListings.category, filter.category))
  if (filter.status) conditions.push(eq(timebankListings.status, filter.status))
  if (filter.authorId) conditions.push(eq(timebankListings.authorId, filter.authorId))

  const rows = await db
    .select(listingColumns)
    .from(timebankListings)
    .innerJoin(memberProfiles, eq(memberProfiles.id, timebankListings.authorId))
    .where(and(...conditions))
    .orderBy(desc(timebankListings.createdAt), desc(timebankListings.id))
    .limit(filter.limit + 1)
    .offset(filter.offset)

  return {
    rows: rows.slice(0, filter.limit).map(row => {
      const { description: _description, ...rest } = toListingRow(row)
      return rest
    }),
    hasNext: rows.length > filter.limit,
  }
}

/** 삭제된 글은 `null`. */
export async function getTimebankListing(id: string): Promise<TimebankListingRow | null> {
  const [row] = await db
    .select(listingColumns)
    .from(timebankListings)
    .innerJoin(memberProfiles, eq(memberProfiles.id, timebankListings.authorId))
    .where(and(eq(timebankListings.id, id), eq(timebankListings.isDeleted, false)))
    .limit(1)
  return row ? toListingRow(row) : null
}

/** 소유·종류 판정용. 삭제된 글은 `null`(없는 것과 같게 404). */
export async function getTimebankListingOwner(id: string): Promise<{
  author_id: string
  title: string
  kind: TimebankListingKind
  status: TimebankListingStatus
} | null> {
  const [row] = await db
    .select({
      authorId: timebankListings.authorId,
      title: timebankListings.title,
      kind: timebankListings.kind,
      status: timebankListings.status,
    })
    .from(timebankListings)
    .where(and(eq(timebankListings.id, id), eq(timebankListings.isDeleted, false)))
    .limit(1)
  return row
    ? { author_id: row.authorId, title: row.title, kind: row.kind, status: row.status }
    : null
}

function fieldsToColumns(fields: Partial<TimebankListingFields>) {
  const out: Partial<typeof timebankListings.$inferInsert> = {}
  if (fields.kind !== undefined) out.kind = fields.kind
  if (fields.category !== undefined) out.category = fields.category
  if (fields.title !== undefined) out.title = fields.title
  if (fields.description !== undefined) out.description = fields.description
  if (fields.estimated_minutes !== undefined) out.estimatedMinutes = fields.estimated_minutes
  if (fields.task_date !== undefined) out.taskDate = fields.task_date
  return out
}

export async function createTimebankListing(
  authorId: string,
  fields: TimebankListingFields
): Promise<{ id: string }> {
  const [row] = await db
    .insert(timebankListings)
    .values({
      authorId,
      kind: fields.kind,
      category: fields.category,
      title: fields.title,
      description: fields.description,
      estimatedMinutes: fields.estimated_minutes,
      taskDate: fields.task_date ?? null,
    })
    .returning({ id: timebankListings.id })
  return { id: row.id }
}

/** 준 칸만 바꾼다. */
export async function updateTimebankListing(
  id: string,
  fields: Partial<TimebankListingFields>
): Promise<void> {
  const set = fieldsToColumns(fields)
  if (Object.keys(set).length === 0) return
  await db
    .update(timebankListings)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(timebankListings.id, id))
}

export async function setTimebankListingStatus(
  id: string,
  status: TimebankListingStatus
): Promise<void> {
  await db
    .update(timebankListings)
    .set({ status, updatedAt: new Date() })
    .where(eq(timebankListings.id, id))
}

export async function closeTimebankListing(id: string): Promise<void> {
  await setTimebankListingStatus(id, 'closed')
}

export async function softDeleteTimebankListing(id: string): Promise<void> {
  await db
    .update(timebankListings)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(eq(timebankListings.id, id))
}

/** 회원별 열린 제공·요청 글 수(도배 방지 상한용). 조합 업무 글은 세지 않는다. */
export async function countOpenListingsByAuthor(authorId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(timebankListings)
    .where(
      and(
        eq(timebankListings.authorId, authorId),
        eq(timebankListings.isDeleted, false),
        eq(timebankListings.status, 'open'),
        inArray(timebankListings.kind, ['offer', 'request'])
      )
    )
  return row?.total ?? 0
}

// ── 댓글 ─────────────────────────────────────────────────────────────────────

export interface TimebankCommentRow {
  id: string
  listing_id: string
  author_id: string
  author_name: string
  /** 삭제된 댓글은 `null`. */
  content: string | null
  is_deleted: boolean
  created_at: string
}

/** 시간 오름차순. 삭제된 댓글은 자리만 남기고 본문을 싣지 않는다. */
export async function listTimebankComments(listingId: string): Promise<TimebankCommentRow[]> {
  const rows = await db
    .select({
      id: timebankComments.id,
      listingId: timebankComments.listingId,
      authorId: timebankComments.authorId,
      authorName: memberProfiles.displayName,
      content: timebankComments.content,
      isDeleted: timebankComments.isDeleted,
      createdAt: timebankComments.createdAt,
    })
    .from(timebankComments)
    .innerJoin(memberProfiles, eq(memberProfiles.id, timebankComments.authorId))
    .where(eq(timebankComments.listingId, listingId))
    .orderBy(asc(timebankComments.createdAt), asc(timebankComments.id))

  return rows.map(row => ({
    id: row.id,
    listing_id: row.listingId,
    author_id: row.authorId,
    author_name: row.authorName,
    content: row.isDeleted ? null : row.content,
    is_deleted: row.isDeleted,
    created_at: toIso(row.createdAt) as string,
  }))
}

export async function createTimebankComment(input: {
  listingId: string
  authorId: string
  content: string
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(timebankComments)
    .values({ listingId: input.listingId, authorId: input.authorId, content: input.content })
    .returning({ id: timebankComments.id })
  return { id: row.id }
}

/** 이 글에 댓글을 남긴 사람들(삭제 제외, 중복 없음). 알림 대상 산출용. */
export async function listTimebankCommenterIds(listingId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ authorId: timebankComments.authorId })
    .from(timebankComments)
    .where(and(eq(timebankComments.listingId, listingId), eq(timebankComments.isDeleted, false)))
  return rows.map(row => row.authorId)
}

/** 소유·경로 대조용(다른 글 경로로 남의 댓글을 지우는 위조를 라우트가 막는다). */
export async function getTimebankCommentOwner(
  id: string
): Promise<{ author_id: string; listing_id: string; is_deleted: boolean } | null> {
  const [row] = await db
    .select({
      authorId: timebankComments.authorId,
      listingId: timebankComments.listingId,
      isDeleted: timebankComments.isDeleted,
    })
    .from(timebankComments)
    .where(eq(timebankComments.id, id))
    .limit(1)
  return row
    ? { author_id: row.authorId, listing_id: row.listingId, is_deleted: row.isDeleted }
    : null
}

export async function softDeleteTimebankComment(id: string): Promise<void> {
  await db
    .update(timebankComments)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(eq(timebankComments.id, id))
}

// ── 조합 업무 자원 ───────────────────────────────────────────────────────────

/**
 * 자원한다. 이미 자원 중이면 아무것도 바꾸지 않는다(`changed: false`). 철회했던
 * 기록은 `withdrawn_at`을 null로 되돌리고 `volunteered_at`을 새로 찍는다.
 * 동시 요청은 UNIQUE(listing, member) + `ON CONFLICT`가 한 행으로 모은다.
 */
export async function volunteer(
  listingId: string,
  memberId: string,
  now: Date = new Date()
): Promise<{ changed: boolean }> {
  const rows = await db
    .insert(timebankTaskVolunteers)
    .values({ listingId, memberId, volunteeredAt: now, withdrawnAt: null })
    .onConflictDoUpdate({
      target: [timebankTaskVolunteers.listingId, timebankTaskVolunteers.memberId],
      set: { withdrawnAt: null, volunteeredAt: now, updatedAt: now },
      // 이미 자원 중인 행은 건드리지 않는다 — 처음 자원한 시각을 보존하고,
      // 영향받은 행 수로 "새로 자원했는가"를 안다.
      setWhere: sql`${timebankTaskVolunteers.withdrawnAt} IS NOT NULL`,
    })
    .returning({ id: timebankTaskVolunteers.id })
  return { changed: rows.length > 0 }
}

/** 자원을 철회한다. 자원 중이 아니면 `changed: false`. */
export async function withdrawVolunteer(
  listingId: string,
  memberId: string,
  now: Date = new Date()
): Promise<{ changed: boolean }> {
  const rows = await db
    .update(timebankTaskVolunteers)
    .set({ withdrawnAt: now, updatedAt: now })
    .where(
      and(
        eq(timebankTaskVolunteers.listingId, listingId),
        eq(timebankTaskVolunteers.memberId, memberId),
        isNull(timebankTaskVolunteers.withdrawnAt)
      )
    )
    .returning({ id: timebankTaskVolunteers.id })
  return { changed: rows.length > 0 }
}

export async function isVolunteering(listingId: string, memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: timebankTaskVolunteers.id })
    .from(timebankTaskVolunteers)
    .where(
      and(
        eq(timebankTaskVolunteers.listingId, listingId),
        eq(timebankTaskVolunteers.memberId, memberId),
        isNull(timebankTaskVolunteers.withdrawnAt)
      )
    )
    .limit(1)
  return Boolean(row)
}

/** 철회하지 않은 자원자. 관리자 지급 화면(Task 9)이 쓴다 — 조합원 라우트는 싣지 않는다. */
export async function listVolunteers(
  listingId: string
): Promise<Array<{ member_id: string; display_name: string; volunteered_at: string }>> {
  const rows = await db
    .select({
      memberId: timebankTaskVolunteers.memberId,
      displayName: memberProfiles.displayName,
      volunteeredAt: timebankTaskVolunteers.volunteeredAt,
    })
    .from(timebankTaskVolunteers)
    .innerJoin(memberProfiles, eq(memberProfiles.id, timebankTaskVolunteers.memberId))
    .where(
      and(
        eq(timebankTaskVolunteers.listingId, listingId),
        isNull(timebankTaskVolunteers.withdrawnAt)
      )
    )
    .orderBy(asc(timebankTaskVolunteers.volunteeredAt), asc(timebankTaskVolunteers.memberId))
  return rows.map(r => ({
    member_id: r.memberId,
    display_name: r.displayName,
    volunteered_at: toIso(r.volunteeredAt) as string,
  }))
}
