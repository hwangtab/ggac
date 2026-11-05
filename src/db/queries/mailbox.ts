/**
 * 관리자 메일함 쿼리 계층 (Turso/Drizzle).
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다**. 누가 이 함수를
 * 부를 자격이 있는지는 라우트가 판정하고, 여기는 검증된 값만 받는다.
 * 응답 조립이나 인가 판정에 쓰는 것은 아무것도 이 파일에 들여오지 않는다.
 */

import { and, asc, desc, eq, gte, inArray, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  inboundEmails,
  inboundEmailAttachments,
  inboundEmailReplies,
  outboundEmails,
  outboundEmailAttachments,
} from '../schema/index.ts'

import {
  toIso,
  toSnakeCase,
  likeContains,
  escapeLikePattern,
  LIKE_ESCAPE_CHAR,
} from './_helpers.ts'

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
 * 본문은 저장됐는데 첨부가 하나라도 빠졌을 때 쓴다.
 *
 * `markBodyFetched`가 먼저 상태를 'done'으로 올려 두므로, 첨부 루프가
 * 끝난 뒤 실패가 하나라도 있으면 이 함수로 'attachments_failed'로 내려
 * 백필 크론(`listPendingInboundEmails`)이 다시 집게 한다. 그전에는 'done'인
 * 채로 굳어 첨부 실패가 24시간이 지나도 아무도 다시 보지 않았다.
 */
export async function markAttachmentsIncomplete(id: string): Promise<void> {
  await db
    .update(inboundEmails)
    .set({ bodyFetchStatus: 'attachments_failed' })
    .where(eq(inboundEmails.id, id))
}

/**
 * 첨부 재시도를 최종 포기한다(Resend 보관 기한을 넘김).
 *
 * `markBodyFetchFailed`와 나란하지만 의미가 다르다 — 본문은 이미 저장돼
 * 있으므로 'failed'(본문 자체가 없다)로 덮으면 실제로 있는 본문을 없는
 * 것처럼 보이게 한다. 'attachments_expired'로 남겨 구분한다.
 */
export async function markAttachmentsExpired(id: string): Promise<void> {
  await db
    .update(inboundEmails)
    .set({ bodyFetchStatus: 'attachments_expired' })
    .where(eq(inboundEmails.id, id))
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

/** 이 메일에 보낸 답장들. 오래된 것부터 — 스레드 순서 그대로 읽힌다. */
export async function listRepliesForEmail(emailId: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(inboundEmailReplies)
    .where(eq(inboundEmailReplies.emailId, emailId))
    .orderBy(asc(inboundEmailReplies.createdAt))
  return rows.map(rowToAttachment)
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
 * `updated_at`을 pending·attachments_failed 행에 한해 "마지막으로 시도한
 * 시각"으로 쓴다. 그 두 상태의 `updated_at`을 바꾸는 코드가 이것 말고는
 * 없고(웹훅 삽입 시점 이후로는 아무도 건드리지 않는다), 화면도 이 값을
 * 그리지 않아 겹치는 소비처가 없다.
 *
 * 이 한 줄이 아래 `listPendingInboundEmails`의 굶김을 푼다 — 자세한 것은
 * 그쪽 주석에 있다.
 */
export async function markBodyFetchAttempted(id: string): Promise<void> {
  await db.update(inboundEmails).set({ updatedAt: new Date() }).where(eq(inboundEmails.id, id))
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
 *
 * `pending`(본문도 못 채움)과 `attachments_failed`(본문은 됐는데 첨부가
 * 빠짐) 둘 다 대상이다 — 첨부만 실패한 행을 빼면 `body_fetch_status`가
 * 'done'으로 굳은 뒤로는 아무도 다시 보지 않는다(과거 실제로 그랬다).
 * `ingestInboundEmail`이 이미 저장된 첨부는 건너뛰고 빠진 것만 다시
 * 받으므로, 같은 함수로 두 상태를 함께 재시도해도 안전하다.
 */
export async function listPendingInboundEmails(limit: number): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(inboundEmails)
    .where(
      or(
        eq(inboundEmails.bodyFetchStatus, 'pending'),
        eq(inboundEmails.bodyFetchStatus, 'attachments_failed')
      )
    )
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

// ─────────────────────────────────────────────────────────────────────────────
// 새 메일 작성(보낸 메일) — outbound_emails
// ─────────────────────────────────────────────────────────────────────────────

export type InsertOutboundInput = {
  idempotency_key: string
  to_addresses: string[]
  cc_addresses: string[]
  bcc_addresses: string[]
  recipient_count: number
  subject: string
  body_html: string
  sent_by: string | null
  sent_by_email: string | null
}

export type OutboundFinalStatus = 'failed' | 'unknown' | 'blocked'

function rowToOutbound(row: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnakeCase(row)
  snake.sent_at = toIso(row.sentAt as Date | null)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  return snake
}

/**
 * 발송 **전에** `sending` 행을 쓴다. `idempotency_key`가 이미 있으면 새 행을 만들지 않고
 * 기존 행을 돌려준다 — 호출부가 그 상태를 보고 중복 발송 여부를 판정한다.
 */
export async function insertOutboundSending(
  input: InsertOutboundInput
): Promise<{ created: boolean; row: Record<string, unknown> }> {
  const inserted = await db
    .insert(outboundEmails)
    .values({
      idempotencyKey: input.idempotency_key,
      toAddresses: JSON.stringify(input.to_addresses),
      ccAddresses: input.cc_addresses.length ? JSON.stringify(input.cc_addresses) : null,
      bccAddresses: input.bcc_addresses.length ? JSON.stringify(input.bcc_addresses) : null,
      recipientCount: input.recipient_count,
      subject: input.subject,
      bodyHtml: input.body_html,
      sentBy: input.sent_by,
      sentByEmail: input.sent_by_email,
      status: 'sending',
    })
    .onConflictDoNothing({ target: outboundEmails.idempotencyKey })
    .returning()
  if (inserted.length > 0) return { created: true, row: rowToOutbound(inserted[0]) }

  const [existing] = await db
    .select()
    .from(outboundEmails)
    .where(eq(outboundEmails.idempotencyKey, input.idempotency_key))
    .limit(1)
  if (!existing) throw new Error('보낸 메일 행을 만들지도, 찾지도 못했습니다.')
  return { created: false, row: rowToOutbound(existing) }
}

/** 발송이 확인된 행만 `sent`로 옮긴다. `sending` 상태일 때만 바꾼다(되돌림 방지). */
export async function markOutboundSent(id: string, resendMessageId: string | null): Promise<void> {
  await db
    .update(outboundEmails)
    .set({ status: 'sent', resendMessageId, sentAt: new Date(), error: null })
    .where(and(eq(outboundEmails.id, id), eq(outboundEmails.status, 'sending')))
}

export async function markOutboundStatus(
  id: string,
  status: OutboundFinalStatus,
  error: string | null
): Promise<void> {
  await db
    .update(outboundEmails)
    .set({ status, error: error ? error.slice(0, 200) : null })
    .where(and(eq(outboundEmails.id, id), eq(outboundEmails.status, 'sending')))
}

/**
 * 운영자가 Resend 대시보드로 확인한 뒤 멈춘 행을 확정한다.
 *
 * 바꿀 수 있는 것은 `unknown`과 `staleBeforeMs`보다 오래된 `sending`뿐이다 — 방금 만든 `sending`은 지금
 * 발송 중인 요청일 수 있어, 그것을 `failed`로 바꾸면 이어서 나가는 메일이 "실패"로 남는다. 상태를 조건에
 * 넣어 갱신하므로 동시에 다른 관리자가 먼저 확정했다면 `conflict`다.
 */
export async function resolveOutboundStatus(
  id: string,
  next: 'sent' | 'failed',
  staleBeforeMs: number
): Promise<'updated' | 'missing' | 'conflict'> {
  const updated = await db
    .update(outboundEmails)
    .set({
      status: next,
      ...(next === 'sent' ? { sentAt: new Date() } : {}),
      error: null,
    })
    .where(
      and(
        eq(outboundEmails.id, id),
        or(
          eq(outboundEmails.status, 'unknown'),
          and(
            eq(outboundEmails.status, 'sending'),
            sql`${outboundEmails.createdAt} < ${staleBeforeMs}`
          )
        )
      )
    )
    .returning({ id: outboundEmails.id })
  if (updated.length > 0) return 'updated'
  const [existing] = await db
    .select({ id: outboundEmails.id })
    .from(outboundEmails)
    .where(eq(outboundEmails.id, id))
    .limit(1)
  return existing ? 'conflict' : 'missing'
}

/**
 * 오래된 `sending`을 `unknown`으로 옮긴다(크론). 함수가 발송 도중 죽으면 행이 `sending`으로 남는데,
 * 화면은 5분이 지나면 "확인 필요"로 그리지만 원장은 여전히 `sending`이라 둘이 어긋난다. `failed`로
 * 옮기면 안 된다 — 메일이 이미 나갔을 수 있다.
 */
export async function markStaleSendingAsUnknown(olderThanMs: number): Promise<number> {
  const updated = await db
    .update(outboundEmails)
    .set({ status: 'unknown', error: '발송 도중 응답이 끊겼습니다. 나갔는지 확인이 필요합니다.' })
    .where(
      and(eq(outboundEmails.status, 'sending'), sql`${outboundEmails.createdAt} < ${olderThanMs}`)
    )
    .returning({ id: outboundEmails.id })
  return updated.length
}

// ─────────────────────────────────────────────────────────────────────────────
// 보관 기한·고아 Blob 정리 (크론: `lib/mail/outboundSweep.ts`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 정리 대상 보낸 메일 id. `statuses`는 호출부가 정한다 — `unknown`·`sending`은 사람이 확인해야 하는
 * 상태라 어떤 보관 기한으로도 지우지 않는다(호출부가 넣지 않는다).
 */
export async function listOutboundIdsForPurge(
  statuses: string[],
  olderThanMs: number,
  limit: number
): Promise<string[]> {
  if (statuses.length === 0) return []
  const rows = await db
    .select({ id: outboundEmails.id })
    .from(outboundEmails)
    .where(
      and(
        inArray(outboundEmails.status, statuses),
        sql`${outboundEmails.createdAt} < ${olderThanMs}`
      )
    )
    .orderBy(asc(outboundEmails.createdAt))
    .limit(limit)
  return rows.map(r => r.id)
}

export async function listAttachmentPathsForOutbound(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ blobPath: outboundEmailAttachments.blobPath })
    .from(outboundEmailAttachments)
    .where(inArray(outboundEmailAttachments.emailId, ids))
  return rows.map(r => r.blobPath)
}

/**
 * 첨부 행을 먼저, 메일 행을 나중에 지운다. FK의 ON DELETE CASCADE가 연결에 따라 꺼져 있을 수 있어
 * 캐스케이드에 기대지 않는다. 지우는 시점에도 상태를 다시 확인해, 그 사이 사람이 확정하거나 다른 상태로
 * 바뀐 행은 건드리지 않는다.
 */
export async function deleteOutboundEmails(ids: string[], statuses: string[]): Promise<number> {
  if (ids.length === 0 || statuses.length === 0) return 0
  const eligible = await db
    .select({ id: outboundEmails.id })
    .from(outboundEmails)
    .where(and(inArray(outboundEmails.id, ids), inArray(outboundEmails.status, statuses)))
  const eligibleIds = eligible.map(r => r.id)
  if (eligibleIds.length === 0) return 0
  await db
    .delete(outboundEmailAttachments)
    .where(inArray(outboundEmailAttachments.emailId, eligibleIds))
  await db.delete(outboundEmails).where(inArray(outboundEmails.id, eligibleIds))
  return eligibleIds.length
}

/** 후보 경로 중 DB 어디에도 참조되지 않는 것만 돌려준다(고아 Blob). */
export async function filterUnreferencedSentPaths(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return []
  const referenced = new Set<string>()
  // SQLite 변수 한도를 넘지 않게 나눠서 묻는다.
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200)
    const rows = await db
      .select({ blobPath: outboundEmailAttachments.blobPath })
      .from(outboundEmailAttachments)
      .where(inArray(outboundEmailAttachments.blobPath, chunk))
    rows.forEach(r => referenced.add(r.blobPath))
  }
  return paths.filter(p => !referenced.has(p))
}

export async function getOutboundEmail(id: string): Promise<Record<string, unknown> | null> {
  const [row] = await db.select().from(outboundEmails).where(eq(outboundEmails.id, id)).limit(1)
  return row ? rowToOutbound(row) : null
}

export async function insertOutboundAttachment(input: {
  id: string
  email_id: string
  filename: string
  content_type: string | null
  size_bytes: number
  blob_path: string
}): Promise<void> {
  await db.insert(outboundEmailAttachments).values({
    id: input.id,
    emailId: input.email_id,
    filename: input.filename,
    contentType: input.content_type,
    sizeBytes: input.size_bytes,
    blobPath: input.blob_path,
  })
}

/** 발송이 안 나간 것이 확실할 때 올려 둔 첨부 행을 지운다(Blob은 호출부가 따로 지운다). */
export async function deleteOutboundAttachmentsForEmail(emailId: string): Promise<void> {
  await db.delete(outboundEmailAttachments).where(eq(outboundEmailAttachments.emailId, emailId))
}

export async function listOutboundAttachments(emailId: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(outboundEmailAttachments)
    .where(eq(outboundEmailAttachments.emailId, emailId))
    .orderBy(asc(outboundEmailAttachments.createdAt))
  return rows.map(rowToAttachment)
}

export async function getOutboundAttachment(id: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select()
    .from(outboundEmailAttachments)
    .where(eq(outboundEmailAttachments.id, id))
    .limit(1)
  return row ? rowToAttachment(row) : null
}

/**
 * `sinceMs` 이후 메일함에서 나간 수신자 수(= Resend가 세는 단위의 보수적 추정).
 * 새 메일은 `recipient_count` 합, 답장은 한 통에 한 명이라 행 수다. 실패·차단은 세지 않는다.
 * `sending`을 센다 — 지금 나가는 중인 요청도 한도를 먹어야 동시 요청이 서로를 본다.
 */
export async function countOutboundRecipientsSince(sinceMs: number): Promise<number> {
  const since = new Date(sinceMs)
  const [composed] = await db
    .select({ total: sql<number>`coalesce(sum(${outboundEmails.recipientCount}), 0)` })
    .from(outboundEmails)
    .where(
      and(
        gte(outboundEmails.createdAt, since),
        inArray(outboundEmails.status, ['sending', 'sent', 'unknown'])
      )
    )
  const [replied] = await db
    .select({ count: sql<number>`count(*)` })
    .from(inboundEmailReplies)
    .where(gte(inboundEmailReplies.createdAt, since))
  return Number(composed?.total ?? 0) + Number(replied?.count ?? 0)
}

export type SentMailKind = 'all' | 'compose' | 'reply'

/**
 * 보낸 편지함 — 새 메일(`outbound_emails`)과 답장(`inbound_email_replies`)을 최신순으로 합친다.
 * 답장의 수신자는 원본 메일의 발신자다. 본문은 싣지 않는다(상세에서 읽는다). BCC도 싣지 않는다.
 */
/**
 * 검색은 **제목·받는 사람·참조**만 본다. 숨은참조(`bcc_addresses`)는 어떤 조건에도 넣지 않는다 —
 * 이사·감사도 이 목록을 보므로, BCC를 검색 대상에 넣으면 "이 주소로 검색하면 나온다/안 나온다"로 BCC
 * 주소를 알아낼 수 있다. 관리자에게도 열지 않는다(권한을 모르는 쿼리 계층이 한 가지 규칙만 갖게 한다).
 */
export async function listSentMail(options: {
  limit: number
  offset: number
  kind: SentMailKind
  search?: string
}): Promise<{ items: Record<string, unknown>[]; total_count: number }> {
  const needle = options.search?.trim()
  const pattern = needle ? `%${escapeLikePattern(needle)}%` : null
  const like = (column: ReturnType<typeof sql.raw>) =>
    sql`${column} LIKE ${pattern} ESCAPE ${LIKE_ESCAPE_CHAR}`
  const composeWhere = pattern
    ? sql` where (${like(sql.raw('o.subject'))} or ${like(sql.raw('o.to_addresses'))} or ${like(sql.raw('o.cc_addresses'))})`
    : sql``
  const replyWhere = pattern
    ? sql` where (${like(sql.raw('r.subject'))} or ${like(sql.raw('ie.from_address'))})`
    : sql``
  const composeSql = sql`
    select o.id as id, 'compose' as kind, o.to_addresses as to_addresses, o.subject as subject,
           o.status as status, o.created_at as created_at, null as related_email_id,
           (select count(*) from outbound_email_attachments a where a.email_id = o.id) as attachment_count
    from outbound_emails o${composeWhere}`
  const replySql = sql`
    select r.id as id, 'reply' as kind, json_array(ie.from_address) as to_addresses, r.subject as subject,
           'sent' as status, r.created_at as created_at, r.email_id as related_email_id,
           0 as attachment_count
    from inbound_email_replies r join inbound_emails ie on ie.id = r.email_id${replyWhere}`
  const union =
    options.kind === 'compose'
      ? composeSql
      : options.kind === 'reply'
        ? replySql
        : sql`${composeSql} union all ${replySql}`

  const rows = await db.all<Record<string, unknown>>(
    sql`select * from (${union}) order by created_at desc, id desc limit ${options.limit} offset ${options.offset}`
  )
  const countRows = await db.all<{ n: number }>(sql`select count(*) as n from (${union})`)

  return {
    items: rows.map(row => ({
      ...row,
      created_at: toIso(new Date(Number(row.created_at))),
      attachment_count: Number(row.attachment_count ?? 0),
    })),
    total_count: Number(countRows[0]?.n ?? 0),
  }
}
