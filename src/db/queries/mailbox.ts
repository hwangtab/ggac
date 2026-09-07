/**
 * 관리자 메일함 쿼리 계층 (Turso/Drizzle).
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다**. 누가 이 함수를
 * 부를 자격이 있는지는 라우트가 판정하고, 여기는 검증된 값만 받는다.
 * 응답 조립이나 인가 판정에 쓰는 것은 아무것도 이 파일에 들여오지 않는다.
 */

import { and, desc, eq, gte, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { inboundEmails, inboundEmailAttachments, inboundEmailReplies } from '../schema/index.ts'

import { toIso, toSnakeCase, LIKE_ESCAPE_CHAR } from './_helpers.ts'

export type InsertInboundEmailInput = {
  resend_email_id: string
  message_id?: string | null
  from_address: string
  to_addresses?: string[]
  cc_addresses?: string[]
  received_for?: string[]
  subject?: string | null
  received_at: Date
}

export type InsertReplyInput = {
  email_id: string
  sent_by?: string | null
  subject: string
  body_html: string
  resend_message_id?: string | null
}

export type ListInboundOptions = {
  limit: number
  offset: number
  status?: string
  search?: string
}

function rowToEmail(row: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnakeCase(row)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  snake.received_at = toIso(row.receivedAt as Date | null)
  return snake
}

function rowToAttachment(row: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnakeCase(row)
  snake.created_at = toIso(row.createdAt as Date | null)
  return snake
}

/**
 * Resend 웹훅으로 받은 메일을 원장에 기록한다. `resend_email_id`가 유니크
 * 키라 웹훅 재전송이 와도 두 번째부터는 `null`을 돌려줄 뿐 새 행을 만들지
 * 않는다.
 */
export async function insertInboundEmail(input: InsertInboundEmailInput) {
  const [row] = await db
    .insert(inboundEmails)
    .values({
      resendEmailId: input.resend_email_id,
      messageId: input.message_id ?? null,
      fromAddress: input.from_address,
      toAddresses: JSON.stringify(input.to_addresses ?? []),
      ccAddresses: JSON.stringify(input.cc_addresses ?? []),
      receivedFor: JSON.stringify(input.received_for ?? []),
      subject: input.subject ?? null,
      receivedAt: input.received_at,
    })
    .onConflictDoNothing({ target: inboundEmails.resendEmailId })
    .returning()
  return row ? rowToEmail(row) : null
}

/** 본문·헤더를 채우고 나면 body_fetch_status를 done으로 옮긴다. */
export async function markBodyFetched(
  id: string,
  patch: {
    body_html: string | null
    body_text: string | null
    headers: string | null
    subject: string | null
  }
): Promise<void> {
  await db
    .update(inboundEmails)
    .set({
      bodyHtml: patch.body_html,
      bodyText: patch.body_text,
      headers: patch.headers,
      subject: patch.subject ?? undefined,
      bodyFetchStatus: 'done',
    })
    .where(eq(inboundEmails.id, id))
}

/** 본문 당겨오기가 실패했을 때 상태만 failed로 남긴다. */
export async function markBodyFetchFailed(id: string): Promise<void> {
  await db.update(inboundEmails).set({ bodyFetchStatus: 'failed' }).where(eq(inboundEmails.id, id))
}

/**
 * 메일함 목록. 본문 컬럼(`body_html`·`body_text`·`headers`)은 select하지
 * 않는다 — 목록 응답에 본문까지 실으면 수 MB가 되고, 화면은 상세에서만
 * 본문을 쓴다.
 */
export async function listInboundEmails(
  options: ListInboundOptions
): Promise<{ emails: Record<string, unknown>[]; total_count: number }> {
  const conditions = []

  if (options.status) {
    conditions.push(eq(inboundEmails.status, options.status))
  }

  if (options.search) {
    const escaped = options.search
      .replaceAll(LIKE_ESCAPE_CHAR, LIKE_ESCAPE_CHAR + LIKE_ESCAPE_CHAR)
      .replaceAll('%', LIKE_ESCAPE_CHAR + '%')
      .replaceAll('_', LIKE_ESCAPE_CHAR + '_')
    const pattern = `%${escaped}%`
    conditions.push(
      or(
        sql`${inboundEmails.subject} LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}`,
        sql`${inboundEmails.fromAddress} LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}`
      )
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const columns = {
    id: inboundEmails.id,
    resendEmailId: inboundEmails.resendEmailId,
    messageId: inboundEmails.messageId,
    fromAddress: inboundEmails.fromAddress,
    toAddresses: inboundEmails.toAddresses,
    ccAddresses: inboundEmails.ccAddresses,
    receivedFor: inboundEmails.receivedFor,
    subject: inboundEmails.subject,
    status: inboundEmails.status,
    bodyFetchStatus: inboundEmails.bodyFetchStatus,
    threadReferences: inboundEmails.threadReferences,
    receivedAt: inboundEmails.receivedAt,
    createdAt: inboundEmails.createdAt,
    updatedAt: inboundEmails.updatedAt,
  }

  const rowsQuery = db
    .select(columns)
    .from(inboundEmails)
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(options.limit)
    .offset(options.offset)

  const countQuery = db.select({ count: sql<number>`count(*)` }).from(inboundEmails)

  const [rows, countRows] = await Promise.all([
    where ? rowsQuery.where(where) : rowsQuery,
    where ? countQuery.where(where) : countQuery,
  ])

  return {
    emails: rows.map(rowToEmail),
    total_count: Number(countRows[0]?.count ?? 0),
  }
}

export async function getInboundEmail(id: string): Promise<Record<string, unknown> | null> {
  const [row] = await db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).limit(1)
  return row ? rowToEmail(row) : null
}

export async function listAttachmentsForEmail(emailId: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(inboundEmailAttachments)
    .where(eq(inboundEmailAttachments.emailId, emailId))
  return rows.map(rowToAttachment)
}

export async function getAttachment(id: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select()
    .from(inboundEmailAttachments)
    .where(eq(inboundEmailAttachments.id, id))
    .limit(1)
  return row ? rowToAttachment(row) : null
}

/**
 * 첨부 원장에 기록한다. `id`는 호출부가 정한다 — Blob 경로에 그 id가
 * 들어가므로 행과 경로가 같은 값을 써야 한다.
 */
export async function insertAttachment(input: {
  id: string
  email_id: string
  filename: string
  content_type: string | null
  content_id: string | null
  size_bytes: number | null
  blob_path: string
}): Promise<void> {
  await db.insert(inboundEmailAttachments).values({
    id: input.id,
    emailId: input.email_id,
    filename: input.filename,
    contentType: input.content_type,
    contentId: input.content_id,
    sizeBytes: input.size_bytes,
    blobPath: input.blob_path,
  })
}

/**
 * 상태 전이. `expected`가 지금 값과 다르면(다른 관리자가 먼저 바꾼 경우)
 * 아무것도 바꾸지 않고 `conflict`를 돌려준다. 행 자체가 없으면 `missing`.
 */
export async function updateInboundStatus(
  id: string,
  expected: string,
  next: string
): Promise<'updated' | 'conflict' | 'missing'> {
  const updated = await db
    .update(inboundEmails)
    .set({ status: next })
    .where(and(eq(inboundEmails.id, id), eq(inboundEmails.status, expected)))
    .returning({ id: inboundEmails.id })
  if (updated.length > 0) return 'updated' as const
  const [existing] = await db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(eq(inboundEmails.id, id))
  return existing ? ('conflict' as const) : ('missing' as const)
}

export async function insertReply(input: InsertReplyInput): Promise<void> {
  await db.insert(inboundEmailReplies).values({
    emailId: input.email_id,
    sentBy: input.sent_by ?? null,
    subject: input.subject,
    bodyHtml: input.body_html,
    resendMessageId: input.resend_message_id ?? null,
  })
}

/** 이미 든 값이면 아무것도 하지 않는다(멱등). */
export async function appendThreadReference(id: string, messageId: string): Promise<void> {
  const [row] = await db
    .select({ refs: inboundEmails.threadReferences })
    .from(inboundEmails)
    .where(eq(inboundEmails.id, id))
  if (!row) return
  const parts = (row.refs ?? '').split(' ').filter(Boolean)
  if (parts.includes(messageId)) return
  parts.push(messageId)
  await db
    .update(inboundEmails)
    .set({ threadReferences: parts.join(' ') })
    .where(eq(inboundEmails.id, id))
}

/** 본문·첨부를 아직 당겨오지 못한 메일. 최근 순으로 `limit`만큼 준다. */
export async function listPendingInboundEmails(limit: number): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.bodyFetchStatus, 'pending'))
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(limit)
  return rows.map(rowToEmail)
}

/** `sinceMs` 이후 수신 건수. 쿼터 감시용. */
export async function countInboundSince(sinceMs: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(inboundEmails)
    .where(gte(inboundEmails.receivedAt, new Date(sinceMs)))
  return Number(row?.count ?? 0)
}
