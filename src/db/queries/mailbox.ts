/**
 * 관리자 메일함 쿼리 계층 (Turso/Drizzle).
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다**. 누가 이 함수를
 * 부를 자격이 있는지는 라우트가 판정하고, 여기는 검증된 값만 받는다.
 * 응답 조립이나 인가 판정에 쓰는 것은 아무것도 이 파일에 들여오지 않는다.
 */

import { and, asc, desc, eq, gte, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { inboundEmails, inboundEmailAttachments, inboundEmailReplies } from '../schema/index.ts'

import { toIso, toSnakeCase, likeContains } from './_helpers.ts'

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
      toAddresses: JSON.stringify(Array.isArray(input.to_addresses) ? input.to_addresses : []),
      ccAddresses: JSON.stringify(Array.isArray(input.cc_addresses) ? input.cc_addresses : []),
      // received_for는 허용 주소 판정의 입력이다 — 배열이 아닌 값이 섞여
      // 문자열로 저장되면 읽는 쪽 JSON.parse가 배열이 아닌 값을 받아 게이트가
      // 조용히 어긋난다.
      receivedFor: JSON.stringify(Array.isArray(input.received_for) ? input.received_for : []),
      subject: input.subject ?? null,
      receivedAt: input.received_at,
    })
    .onConflictDoNothing({ target: inboundEmails.resendEmailId })
    .returning()
  return row ? rowToEmail(row) : null
}

/**
 * 본문·헤더를 채우고 나면 body_fetch_status를 done으로 옮긴다.
 *
 * `patch.subject`가 `null`이면 기존 제목을 그대로 둔다 — 웹훅 메타데이터
 * 단계에서 이미 제목을 넣어 뒀는데, 본문 조회 결과가 제목을 안 준다고 해서
 * 그 값을 지우면 안 된다. Drizzle의 `.set()`은 `undefined` 필드를 UPDATE에서
 * 아예 빼므로, `null`을 그대로 넘기면(컬럼을 NULL로 덮어씀) 안 되고
 * `undefined`로 바꿔 넘겨야 "값 유지"가 된다.
 */
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

/**
 * 상태를 failed로 최종 확정한다.
 *
 * **웹훅 직후의 본문 조회 실패에는 쓰지 않는다** — 그 경로는 상태를
 * 'pending'으로 둬야 `listPendingInboundEmails`(백필)가 다시 집어 재시도할
 * 수 있다. 이 함수는 Task 9의 백필이 **Resend 보관 기한(30일)을 넘긴
 * pending을 더 재시도해 봐야 소용없다고 판단했을 때** 최종 포기 표시로
 * 쓰는 자리다.
 */
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
    conditions.push(
      or(
        likeContains(inboundEmails.subject, options.search),
        likeContains(inboundEmails.fromAddress, options.search)
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
    .orderBy(desc(inboundEmails.receivedAt), desc(inboundEmails.id))
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

/**
 * 이번 실행이 이 행을 집었다고 적는다. **`updated_at`만 민다.**
 *
 * 전용 칸(`attempt_count`·`last_attempted_at`)이 없어서 이미 있는
 * `updated_at`을 pending 행에 한해 "마지막으로 시도한 시각"으로 쓴다. pending
 * 행의 `updated_at`을 바꾸는 코드가 이것 말고는 없고(웹훅 삽입 시점 이후로는
 * 아무도 건드리지 않는다), 화면도 이 값을 그리지 않아 겹치는 소비처가 없다.
 *
 * 이 한 줄이 아래 `listPendingInboundEmails`의 굶김을 푼다 — 자세한 것은
 * 그쪽 주석에 있다.
 */
export async function markBodyFetchAttempted(id: string): Promise<void> {
  await db
    .update(inboundEmails)
    .set({ updatedAt: new Date() })
    .where(eq(inboundEmails.id, id))
}

/**
 * 본문·첨부를 아직 당겨오지 못한 메일. **오래 방치된 순**으로 `limit`만큼 준다.
 *
 * 정렬 1순위는 `updated_at`(= 백필이 마지막으로 시도한 시각,
 * `markBodyFetchAttempted` 참고)이고, 2순위가 `received_at`이다. 한 번도 집힌
 * 적 없는 행은 `updated_at`이 삽입 시각 그대로라 자연히 앞쪽에 오고, 그들끼리는
 * 받은 순서대로 선다 — 즉 **아무도 실패하지 않는 한 옛 동작(오래된 순)과 같다.**
 *
 * 1순위를 `received_at`에서 옮긴 이유. 매번 실패하는 행 — 예를 들어 Resend가
 * 그 메일만 500을 주는 경우 — 은 상태가 계속 'pending'이라 오래된 순 큐의 맨
 * 앞에 눌러앉는다. 크론은 한 시간에 한 번 25칸을 집는데 그 칸을 같은 행들이
 * 30일 동안(= Resend 보관 기한, 그때서야 `markBodyFetchFailed`로 포기한다)
 * 계속 차지하면, 정작 다시 당기면 살아났을 **새 pending 메일이 그 뒤에서
 * 굶는다.** 시도할 때마다 `updated_at`이 밀려 뒤로 가므로 이제는 한 바퀴씩
 * 돌아가며 집힌다.
 *
 * 컷오프는 여전히 닿는다. 모든 pending 행이 라운드로빈으로 돌아오므로
 * 30일을 넘긴 행도 (백로그 크기 ÷ 배치)번 실행 안에 반드시 한 번 집히고,
 * 그때 `markBodyFetchFailed`가 큐에서 내보낸다. 최신순으로 주던 옛 설계가
 * 컷오프를 사문화시켰던 것과는 다르다 — 그쪽은 오래된 행이 **영원히** 집히지
 * 않았다.
 *
 * `id`(UUID)를 마지막 타이브레이커로 둔다 — 앞의 두 값이 같은 행이 여러 개일
 * 때도 실행마다 순서가 흔들리지 않게 하기 위해서다.
 */
export async function listPendingInboundEmails(limit: number): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.bodyFetchStatus, 'pending'))
    .orderBy(asc(inboundEmails.updatedAt), asc(inboundEmails.receivedAt), asc(inboundEmails.id))
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
