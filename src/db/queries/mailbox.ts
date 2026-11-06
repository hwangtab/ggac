/**
 * 관리자 메일함 쿼리 계층 (Turso/Drizzle).
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다**. 누가 이 함수를
 * 부를 자격이 있는지는 라우트가 판정하고, 여기는 검증된 값만 받는다.
 * 응답 조립이나 인가 판정에 쓰는 것은 아무것도 이 파일에 들여오지 않는다.
 */

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  inboundEmails,
  inboundEmailAttachments,
  inboundEmailReplies,
  outboundEmails,
  outboundEmailAttachments,
  memberProfiles,
} from '../schema/index.ts'

import {
  toIso,
  toSnakeCase,
  likeContains,
  escapeLikePattern,
  LIKE_ESCAPE_CHAR,
} from './_helpers.ts'
import { parseMailbox } from '../../lib/mail/senderAddress.ts'

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
  to_address?: string | null
  cc_addresses?: string[]
  /** 생략하면 1(예전 답장과 같다). */
  recipient_count?: number
}

export type ListInboundOptions = {
  limit: number
  offset: number
  status?: string
  search?: string
  /** 정규화된 발신 주소. `from_email`과 완전 일치. */
  fromEmail?: string
  /** 정규화된 도메인(`a.org`). `from_email`이 `@a.org`로 끝나는 행. */
  fromDomain?: string
  /** 첨부(인라인 이미지 제외)가 있는 메일만. */
  hasAttachment?: boolean
  /** `received_at >= receivedFrom` */
  receivedFrom?: Date
  /** `received_at < receivedUntil` (배타 — 호출부가 "그날 끝"을 다음 날 0시로 넘긴다) */
  receivedUntil?: Date
  /** 이 사람이 담당자인 메일만("내 담당"). */
  assignedTo?: string
  /** 이 라벨이 붙은 메일만. */
  labelId?: string
  /**
   * 다시 알림을 건 메일(시각이 아직 안 지난 것) — `hide`(기본: 목록에서 뺀다) | `only`("다시 알림" 보기) | `include`
   * (검색·거르기 중에는 함께 보인다).
   */
  snoozed?: 'hide' | 'only' | 'include'
  /** 다시 알림 판정의 기준 시각. 시험이 고정하려고 받는다. */
  now?: Date
}

/**
 * "첨부가 있다"로 셀 첨부 — 본문에 박힌 인라인 이미지(`cid:` 참조가 있는 `image/*`)는 뺀다. 서명 로고 하나로
 * 거의 모든 메일이 "첨부 있음"이 되는 것을 막는다. 목록의 클립 아이콘과 `hasAttachment` 필터가 같은 규칙을 쓴다.
 *
 * 바깥 행 참조는 표 이름까지 박아 쓴다 — Drizzle은 단일 표 select 목록에서 `inboundEmails.id`를 `"id"`로만
 * 그려, 서브쿼리 안에서 첨부 행 자신의 `id`로 묶여 버린다(조건절에서는 맞고 select 목록에서만 0이 나왔다).
 */
const realAttachmentCount = sql<number>`(select count(*) from ${inboundEmailAttachments} a
  where a.email_id = "inbound_emails"."id"
    and not (a.content_id is not null and coalesce(a.content_type, '') like 'image/%'))`

function parseLabels(raw: unknown): { id: string; name: string; color: string }[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => item && typeof item.id === 'string')
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
  } catch {
    return []
  }
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
  const sender = parseMailbox(input.from_address)
  // 대화 id는 처음에 자기 id다 — 본문을 당겨 헤더가 오면 `assignThread`가 앞 메일의 대화로 옮긴다.
  const id = crypto.randomUUID()
  const [row] = await db
    .insert(inboundEmails)
    .values({
      id,
      threadId: id,
      resendEmailId: input.resend_email_id,
      messageId: input.message_id ?? null,
      fromAddress: input.from_address,
      fromEmail: sender.email || null,
      fromName: sender.name,
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

  if (options.fromEmail) {
    conditions.push(eq(inboundEmails.fromEmail, options.fromEmail))
  }

  if (options.fromDomain) {
    // 뒤쪽 일치라 `likeContains`(양쪽 %)를 못 쓴다. `@`를 붙여 `xa.org`가 `a.org`에 걸리지 않게 한다.
    conditions.push(
      sql`${inboundEmails.fromEmail} LIKE ${'%@' + escapeLikePattern(options.fromDomain)} ESCAPE ${LIKE_ESCAPE_CHAR}`
    )
  }

  const snoozeNow = options.now ?? new Date()
  if ((options.snoozed ?? 'hide') === 'hide') {
    conditions.push(
      or(sql`${inboundEmails.snoozedUntil} is null`, lt(inboundEmails.snoozedUntil, snoozeNow))
    )
  } else if (options.snoozed === 'only') {
    conditions.push(gte(inboundEmails.snoozedUntil, snoozeNow))
  }

  if (options.labelId) {
    conditions.push(
      sql`exists (select 1 from inbound_email_labels l
        where l.email_id = ${inboundEmails.id} and l.label_id = ${options.labelId})`
    )
  }

  if (options.assignedTo) {
    conditions.push(eq(inboundEmails.assignedTo, options.assignedTo))
  }

  if (options.hasAttachment) {
    conditions.push(sql`${realAttachmentCount} > 0`)
  }

  if (options.receivedFrom) {
    conditions.push(gte(inboundEmails.receivedAt, options.receivedFrom))
  }

  if (options.receivedUntil) {
    conditions.push(lt(inboundEmails.receivedAt, options.receivedUntil))
  }

  if (options.search) {
    // 본문은 `body_text`만 본다 — `body_html`은 태그·속성까지 걸려 엉뚱한 메일이 나온다. 수신량이 하루 수십
    // 건이라 LIKE 전체 훑기로 충분하다. 느려지면 FTS5로 옮긴다.
    conditions.push(
      or(
        likeContains(inboundEmails.subject, options.search),
        likeContains(inboundEmails.fromAddress, options.search),
        likeContains(inboundEmails.bodyText, options.search)
      )
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const columns = {
    id: inboundEmails.id,
    resendEmailId: inboundEmails.resendEmailId,
    messageId: inboundEmails.messageId,
    fromAddress: inboundEmails.fromAddress,
    fromEmail: inboundEmails.fromEmail,
    fromName: inboundEmails.fromName,
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
    attachmentCount: realAttachmentCount,
    threadId: inboundEmails.threadId,
    // 같은 대화의 받은 메일 수(자기 포함). 바깥 열은 `realAttachmentCount`와 같은 이유로 표 이름까지 박는다.
    threadCount: sql<number>`(select count(*) from inbound_emails t
      where t.thread_id = "inbound_emails"."thread_id")`,
    assignedTo: inboundEmails.assignedTo,
    snoozedUntil: inboundEmails.snoozedUntil,
    // 담당자 이름(표시 이름만). 바깥 열은 위의 개수들과 같은 이유로 표 이름까지 박는다.
    assigneeName: sql<string | null>`(select display_name from member_profiles m
      where m.id = "inbound_emails"."assigned_to")`,
    // 붙은 라벨 — JSON 배열 문자열(없으면 '[]'). 정렬은 아래에서 한다(json_group_array는 순서를 보장하지 않는다).
    labelsJson: sql<string>`(select json_group_array(json_object('id', ml.id, 'name', ml.name, 'color', ml.color))
      from inbound_email_labels l join mail_labels ml on ml.id = l.label_id
      where l.email_id = "inbound_emails"."id")`,
    // 내부 메모 수 — 개수만 센다. 메모 본문은 이 파일에서 읽지 않는다(발송 경로가 들여오는 파일이라 메모 쿼리는 따로 둔다).
    noteCount: sql<number>`(select count(*) from inbound_email_notes n
      where n.email_id = "inbound_emails"."id")`,
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
    emails: rows.map(row => {
      const { attachmentCount, threadCount, noteCount, assigneeName, labelsJson, ...rest } = row
      return {
        ...rowToEmail(rest),
        labels: parseLabels(labelsJson),
        assignee_name: assigneeName ?? null,
        attachment_count: Number(attachmentCount ?? 0),
        thread_count: Number(threadCount ?? 1),
        note_count: Number(noteCount ?? 0),
      }
    }),
    total_count: Number(countRows[0]?.count ?? 0),
  }
}

export type SenderSummary = {
  email: string
  /** 가장 최근 메일의 표시 이름. */
  name: string | null
  inbound_count: number
  first_received_at: string | null
  last_received_at: string | null
  /** 이 사람의 메일에 우리가 보낸 답장 수. */
  reply_count: number
  /** 이 사람을 받는 사람·참조로 넣어 **나간**(`sent`) 새 메일 수. */
  sent_count: number
}

/**
 * 발신자 카드. `email`은 정규화된 주소(`from_email`과 같은 꼴)여야 한다.
 *
 * 새 메일 수는 **받는 사람·참조만** 센다. 숨은참조(`bcc_addresses`)는 넣지 않는다 — 이사·감사도 이 카드를
 * 보므로 BCC까지 세면 "이 주소의 숫자가 늘었다"로 BCC 수신자를 알아낼 수 있다(`listSentMail`과 같은 규칙).
 * 새 메일의 주소는 `normalizeAddress`(composeValidation)가 소문자 순수 주소로 저장하므로 완전 일치로 본다.
 */
export async function getSenderSummary(email: string): Promise<SenderSummary> {
  const [inbound] = await db.all<{ n: number; first: number | null; last: number | null }>(
    sql`select count(*) as n, min(received_at) as first, max(received_at) as last
        from inbound_emails where from_email = ${email}`
  )
  const [named] = await db.all<{ from_name: string | null }>(
    sql`select from_name from inbound_emails where from_email = ${email} and from_name is not null
        order by received_at desc limit 1`
  )
  const [replies] = await db.all<{ n: number }>(
    sql`select count(*) as n from inbound_email_replies r
        join inbound_emails ie on ie.id = r.email_id where ie.from_email = ${email}`
  )
  const [sent] = await db.all<{ n: number }>(
    sql`select count(*) as n from outbound_emails o where o.status = 'sent' and (
          exists (select 1 from json_each(o.to_addresses) where value = ${email})
          or exists (select 1 from json_each(o.cc_addresses) where value = ${email}))`
  )
  const at = (ms: number | null) =>
    ms === null || ms === undefined ? null : toIso(new Date(Number(ms)))
  return {
    email,
    name: named?.from_name ?? null,
    inbound_count: Number(inbound?.n ?? 0),
    first_received_at: at(inbound?.first ?? null),
    last_received_at: at(inbound?.last ?? null),
    reply_count: Number(replies?.n ?? 0),
    sent_count: Number(sent?.n ?? 0),
  }
}

/**
 * 이 주소로 가입한 회원. 없으면 null. 회원 정보라 **누구에게 보여 줄지는 라우트가 정한다**(지금은 관리자만).
 * 고르는 칸은 화면 배지에 필요한 것뿐이다 — 연락처·계좌 같은 칸은 꺼내지 않는다.
 */
export async function findMemberByEmail(email: string): Promise<{
  id: string
  display_name: string
  registration_status: string
  is_active: boolean
} | null> {
  const [row] = await db
    .select({
      id: memberProfiles.id,
      displayName: memberProfiles.displayName,
      registrationStatus: memberProfiles.registrationStatus,
      isActive: memberProfiles.isActive,
    })
    .from(memberProfiles)
    .where(sql`lower(${memberProfiles.email}) = ${email}`)
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    display_name: row.displayName,
    registration_status: String(row.registrationStatus ?? ''),
    is_active: Boolean(row.isActive),
  }
}

/**
 * 헤더가 가리키는 앞 메일(`messageIds`, `referencedMessageIds`의 결과)을 찾아 이 메일을 그 대화로 옮긴다.
 *
 * 앞 메일(이 메일보다 늦지 않게 받은 것)이 여럿이면 가장 먼저 받은 것의 대화를 고른다(0038 백필과 같은 규칙).
 * 못 찾으면 아무것도 바꾸지 않는다 —
 * 삽입 때 둔 자기 id가 그대로 남는다. 본문 재시도에서 다시 불려도 같은 결과다(멱등).
 *
 * 한계: 앞 메일이 **나중에** 도착하면(순서 뒤바뀜) 이미 들어온 뒷 메일을 거슬러 옮기지 않는다.
 */
export async function assignThread(id: string, messageIds: string[]): Promise<string | null> {
  if (messageIds.length === 0) return null
  const [parent] = await db
    .select({ id: inboundEmails.id, threadId: inboundEmails.threadId })
    .from(inboundEmails)
    .where(
      and(
        inArray(inboundEmails.messageId, messageIds),
        sql`${inboundEmails.id} <> ${id}`,
        // 앞 메일만 — 서로를 가리키는 두 메일이 대화를 맞바꾸지 않게 한다(0038과 같은 조건).
        sql`${inboundEmails.receivedAt} <= (select received_at from inbound_emails where id = ${id})`
      )
    )
    .orderBy(asc(inboundEmails.receivedAt), asc(inboundEmails.id))
    .limit(1)
  if (!parent) return null
  const threadId = parent.threadId ?? parent.id
  await db.update(inboundEmails).set({ threadId }).where(eq(inboundEmails.id, id))
  return threadId
}

/**
 * 받은 메일이 **우리가 새로 작성해 보낸** 메일에 온 답장인지 잇는다 — 헤더의 id와 `outbound_emails.message_id`를
 * 정확히 대조한다(제목·수신자 추측이 아니다). 잇지 못하면 아무것도 바꾸지 않는다.
 *
 * 헤더 기반 대화 묶기(`assignThread`)가 부모를 못 찾았을 때만 부른다 — 받은 메일에 대한 답장이면 거기서 이미
 * 대화가 정해진다. 같은 메일이 두 번 불려도 결과가 같다(멱등) — 이미 이어져 있으면 그 id를 돌려준다.
 */
export async function linkSentReply(id: string, messageIds: string[]): Promise<string | null> {
  if (messageIds.length === 0) return null
  const [sent] = await db
    .select({ id: outboundEmails.id })
    .from(outboundEmails)
    .where(and(inArray(outboundEmails.messageId, messageIds), eq(outboundEmails.status, 'sent')))
    .limit(1)
  if (!sent) return null
  await db.update(inboundEmails).set({ replyToOutboundId: sent.id }).where(eq(inboundEmails.id, id))
  return sent.id
}

/**
 * 보낸 메일에 실제로 붙은 `Message-ID`를 기록한다 — 발송 직후 Resend에 물어본 값(`src/lib/mail/sentMessageId.ts`).
 * 이미 있으면 건드리지 않는다(늦게 도착한 조회가 최신 값을 덮지 않게).
 */
export async function setOutboundMessageId(id: string, messageId: string): Promise<void> {
  await db
    .update(outboundEmails)
    .set({ messageId })
    .where(and(eq(outboundEmails.id, id), isNull(outboundEmails.messageId)))
}

/** `Message-ID`가 아직 없는 `sent` 행 — 백필 크론이 Resend에 다시 물어본다(조회 실패는 다음 실행이 이어받는다). */
export async function listSentWithoutMessageId(
  limit: number
): Promise<{ id: string; resend_message_id: string }[]> {
  const rows = await db
    .select({ id: outboundEmails.id, resendMessageId: outboundEmails.resendMessageId })
    .from(outboundEmails)
    .where(
      and(
        eq(outboundEmails.status, 'sent'),
        isNull(outboundEmails.messageId),
        isNotNull(outboundEmails.resendMessageId)
      )
    )
    .orderBy(desc(outboundEmails.sentAt))
    .limit(limit)
  return rows.map(row => ({
    id: String(row.id),
    resend_message_id: String(row.resendMessageId),
  }))
}

/** 상세 화면이 "보낸 편지함의 …에 온 답장"으로 보여 줄 머리글. 지워졌으면 null. */
export async function getSentMailSummary(id: string): Promise<{
  id: string
  subject: string
  sent_at: string | null
  sent_by_email: string | null
} | null> {
  const [row] = await db
    .select({
      id: outboundEmails.id,
      subject: outboundEmails.subject,
      sentAt: outboundEmails.sentAt,
      sentByEmail: outboundEmails.sentByEmail,
    })
    .from(outboundEmails)
    .where(eq(outboundEmails.id, id))
    .limit(1)
  if (!row) return null
  return {
    id: String(row.id),
    subject: String(row.subject ?? ''),
    sent_at: toIso((row.sentAt as Date | null) ?? null),
    sent_by_email: (row.sentByEmail as string | null) ?? null,
  }
}

export type ThreadItem =
  | {
      kind: 'inbound'
      id: string
      from_email: string | null
      from_name: string | null
      from_address: string
      subject: string | null
      status: string
      at: string | null
    }
  | { kind: 'reply'; id: string; email_id: string; subject: string; at: string | null }

/**
 * 대화 한 줄기 — 받은 메일과 그 메일들에 보낸 우리 답장을 시간순으로. 본문은 싣지 않는다(각 메일 상세에서 읽는다).
 * 대화 id로만 고르므로 다른 대화의 메일은 섞이지 않는다.
 */
export async function listThread(threadId: string): Promise<ThreadItem[]> {
  const inbound = await db
    .select({
      id: inboundEmails.id,
      fromEmail: inboundEmails.fromEmail,
      fromName: inboundEmails.fromName,
      fromAddress: inboundEmails.fromAddress,
      subject: inboundEmails.subject,
      status: inboundEmails.status,
      receivedAt: inboundEmails.receivedAt,
    })
    .from(inboundEmails)
    .where(eq(inboundEmails.threadId, threadId))
    .orderBy(asc(inboundEmails.receivedAt), asc(inboundEmails.id))
  const replies =
    inbound.length === 0
      ? []
      : await db
          .select({
            id: inboundEmailReplies.id,
            emailId: inboundEmailReplies.emailId,
            subject: inboundEmailReplies.subject,
            createdAt: inboundEmailReplies.createdAt,
          })
          .from(inboundEmailReplies)
          .where(
            inArray(
              inboundEmailReplies.emailId,
              inbound.map(row => row.id)
            )
          )
  const items: (ThreadItem & { sortAt: number })[] = [
    ...inbound.map(row => ({
      kind: 'inbound' as const,
      id: row.id,
      from_email: row.fromEmail,
      from_name: row.fromName,
      from_address: row.fromAddress,
      subject: row.subject,
      status: row.status,
      at: toIso(row.receivedAt),
      sortAt: row.receivedAt?.getTime() ?? 0,
    })),
    ...replies.map(row => ({
      kind: 'reply' as const,
      id: row.id,
      email_id: row.emailId,
      subject: row.subject,
      at: toIso(row.createdAt),
      sortAt: row.createdAt?.getTime() ?? 0,
    })),
  ]
  items.sort((a, b) => a.sortAt - b.sortAt)
  return items.map(({ sortAt: _sortAt, ...item }) => item)
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

/**
 * 담당자 지정·해제 — 상태 변경과 같은 낙관적 동시성. 화면이 알던 담당자(`expected`, 없으면 null)와 지금 값이 다르면
 * (다른 관리자가 먼저 바꿈) 아무것도 바꾸지 않고 `conflict`. 비교는 `IS`로 한다 — "담당자 없음"(NULL)도 기대값이다.
 * 누가 담당자가 될 수 있는지는 라우트가 판정한다.
 */
export async function setInboundAssignee(input: {
  id: string
  expected: string | null
  next: string | null
  by: string
}): Promise<'updated' | 'conflict' | 'missing'> {
  const updated = await db
    .update(inboundEmails)
    .set({
      assignedTo: input.next,
      assignedAt: input.next ? new Date() : null,
      assignedBy: input.next ? input.by : null,
    })
    .where(
      and(eq(inboundEmails.id, input.id), sql`${inboundEmails.assignedTo} IS ${input.expected}`)
    )
    .returning({ id: inboundEmails.id })
  if (updated.length > 0) return 'updated'
  const [existing] = await db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(eq(inboundEmails.id, input.id))
  return existing ? 'conflict' : 'missing'
}

/** 다시 알림 걸기(`until`)·풀기(null). 없는 메일이면 `missing`. 판정(시각 범위·권한)은 라우트가 한다. */
export async function setInboundSnooze(input: {
  id: string
  until: Date | null
  by: string
}): Promise<'updated' | 'missing'> {
  const rows = await db
    .update(inboundEmails)
    .set({ snoozedUntil: input.until, snoozedBy: input.until ? input.by : null })
    .where(eq(inboundEmails.id, input.id))
    .returning({ id: inboundEmails.id })
  return rows.length > 0 ? 'updated' : 'missing'
}

/**
 * 시각이 지난 다시 알림을 깨운다 — 메일함 크론이 매시 부른다. 안 읽음으로 되돌리고 `snoozed_until`을 비운다(건 사람은
 * 남긴다 — 알림 받을 사람을 고르는 데 쓴다). 조건부 UPDATE … RETURNING 한 번이라 두 크론이 겹쳐도 한 메일을 두 번
 * 깨우지 않는다. 스팸으로 옮긴 메일은 상태를 되돌리지 않는다(다시 알림만 풀린다). 한 번에 `limit`통까지.
 */
export async function wakeSnoozedEmails(
  now: Date,
  limit = 100
): Promise<
  { id: string; subject: string | null; assigned_to: string | null; snoozed_by: string | null }[]
> {
  const due = db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(lt(inboundEmails.snoozedUntil, new Date(now.getTime() + 1)))
    .limit(limit)
  const rows = await db
    .update(inboundEmails)
    .set({
      snoozedUntil: null,
      status: sql`case when ${inboundEmails.status} = 'spam' then 'spam' else 'unread' end`,
    })
    .where(
      and(
        inArray(inboundEmails.id, due),
        lt(inboundEmails.snoozedUntil, new Date(now.getTime() + 1))
      )
    )
    .returning({
      id: inboundEmails.id,
      subject: inboundEmails.subject,
      assignedTo: inboundEmails.assignedTo,
      snoozedBy: inboundEmails.snoozedBy,
    })
  return rows.map(row => ({
    id: row.id,
    subject: row.subject,
    assigned_to: row.assignedTo,
    snoozed_by: row.snoozedBy,
  }))
}

export type BulkStatusOutcome = { updated: string[]; conflict: string[]; missing: string[] }

/**
 * 여러 메일의 상태를 한 번에 바꾼다 — `updateInboundStatus`와 같은 낙관적 동시성을 메일마다 지킨다. 화면이 알던
 * 상태(`expected`)와 지금 값이 다른 메일(다른 관리자가 먼저 바꿈)은 건드리지 않고 `conflict`로, 행이 없으면
 * `missing`으로 돌려준다.
 *
 * 메일마다 왕복하지 않는다 — 기대 상태별로 묶어 조건부 UPDATE를 한 번씩(상태가 다섯이라 많아야 다섯 번) 보낸다.
 * 이미 목표 상태인 메일은 바꿀 것이 없으므로 `updated`로 친다(같은 상태로 두 번 누른 것과 같다).
 */
export async function updateInboundStatusBulk(
  items: { id: string; expected: string }[],
  next: string
): Promise<BulkStatusOutcome> {
  const byExpected = new Map<string, string[]>()
  for (const item of items) {
    byExpected.set(item.expected, [...(byExpected.get(item.expected) ?? []), item.id])
  }
  const updated = new Set<string>()
  for (const [expected, ids] of byExpected) {
    const rows = await db
      .update(inboundEmails)
      .set({ status: next })
      .where(and(inArray(inboundEmails.id, ids), eq(inboundEmails.status, expected)))
      .returning({ id: inboundEmails.id })
    for (const row of rows) updated.add(row.id)
  }
  const rest = items.map(item => item.id).filter(id => !updated.has(id))
  const existing =
    rest.length === 0
      ? []
      : await db
          .select({ id: inboundEmails.id, status: inboundEmails.status })
          .from(inboundEmails)
          .where(inArray(inboundEmails.id, rest))
  const conflict: string[] = []
  for (const row of existing) {
    if (row.status === next) updated.add(row.id)
    else conflict.push(row.id)
  }
  const found = new Set(existing.map(row => row.id))
  return {
    updated: items.map(item => item.id).filter(id => updated.has(id)),
    conflict,
    missing: rest.filter(id => !found.has(id)),
  }
}

export async function insertReply(input: InsertReplyInput): Promise<void> {
  await db.insert(inboundEmailReplies).values({
    emailId: input.email_id,
    sentBy: input.sent_by ?? null,
    subject: input.subject,
    bodyHtml: input.body_html,
    resendMessageId: input.resend_message_id ?? null,
    toAddress: input.to_address ?? null,
    ccAddresses:
      input.cc_addresses && input.cc_addresses.length > 0
        ? JSON.stringify(input.cc_addresses)
        : null,
    recipientCount: input.recipient_count ?? 1,
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
        // **`updated_at` 기준이다.** 상태가 정해진 시각이 기한의 시작이다 — `created_at`이면 오래 `unknown`이던
        // 메일을 운영자가 "안 나갔음"으로 확정하는 순간 다음 크론이 바로 지워 버린다.
        sql`${outboundEmails.updatedAt} < ${olderThanMs}`
      )
    )
    .orderBy(asc(outboundEmails.updatedAt))
    .limit(limit)
  return rows.map(r => r.id)
}

/**
 * 정리 대상 메일을 **조건부로** 지우고, 그때 실제로 지워진 메일의 첨부 경로를 돌려준다.
 *
 * 지우는 시점에 상태를 다시 확인한다 — 후보로 뽑힌 뒤 다른 요청이 상태를 바꿨다면 건드리지 않는다.
 * 첨부 행을 먼저, 메일 행을 나중에 지운다(FK의 ON DELETE CASCADE가 연결에 따라 꺼져 있을 수 있어 기대지 않는다).
 * Blob은 호출부가 **이 함수가 끝난 뒤** 지운다 — 행이 사라진 것이 확인된 파일만 지우기 위해서다.
 */
export async function deleteOutboundEmailsReturningPaths(
  ids: string[],
  statuses: string[]
): Promise<{ deletedCount: number; blobPaths: string[] }> {
  if (ids.length === 0 || statuses.length === 0) return { deletedCount: 0, blobPaths: [] }
  const eligible = await db
    .select({ id: outboundEmails.id })
    .from(outboundEmails)
    .where(and(inArray(outboundEmails.id, ids), inArray(outboundEmails.status, statuses)))
  const eligibleIds = eligible.map(r => r.id)
  if (eligibleIds.length === 0) return { deletedCount: 0, blobPaths: [] }

  const pathRows = await db
    .select({ blobPath: outboundEmailAttachments.blobPath })
    .from(outboundEmailAttachments)
    .where(inArray(outboundEmailAttachments.emailId, eligibleIds))

  await db
    .delete(outboundEmailAttachments)
    .where(inArray(outboundEmailAttachments.emailId, eligibleIds))
  // 메일 행 삭제에도 상태 조건을 다시 건다 — 첨부 경로를 읽은 뒤 바뀐 행을 지우지 않는다.
  const deleted = await db
    .delete(outboundEmails)
    .where(and(inArray(outboundEmails.id, eligibleIds), inArray(outboundEmails.status, statuses)))
    .returning({ id: outboundEmails.id })

  return { deletedCount: deleted.length, blobPaths: pathRows.map(r => r.blobPath) }
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
  // 답장은 행마다 받은 사람 수(`recipient_count`, 0039)를 센다 — 전체 답장 한 통은 여러 명에게 간다.
  const [replied] = await db
    .select({ total: sql<number>`coalesce(sum(${inboundEmailReplies.recipientCount}), 0)` })
    .from(inboundEmailReplies)
    .where(gte(inboundEmailReplies.createdAt, since))
  return Number(composed?.total ?? 0) + Number(replied?.total ?? 0)
}

export type SentMailKind = 'all' | 'compose' | 'reply'

/**
 * 보낸 편지함 — 새 메일(`outbound_emails`)과 답장(`inbound_email_replies`)을 최신순으로 합친다.
 * 답장의 받는 사람은 기록한 `to_address`(0039 이전 행은 원본 발신자)다. 본문은 싣지 않는다(상세에서 읽는다). BCC도 싣지 않는다.
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
  // 답장의 받는 사람은 기록한 칸(0039)이 정본이고, 그 전 행은 원본 발신자다. 참조도 찾는다(답장에는 숨은참조가 없다).
  const replyWhere = pattern
    ? sql` where (${like(sql.raw('r.subject'))} or ${like(sql.raw('coalesce(r.to_address, ie.from_address)'))} or ${like(sql.raw('r.cc_addresses'))})`
    : sql``
  const composeSql = sql`
    select o.id as id, 'compose' as kind, o.to_addresses as to_addresses, o.subject as subject,
           o.status as status, o.created_at as created_at, null as related_email_id,
           (select count(*) from outbound_email_attachments a where a.email_id = o.id) as attachment_count
    from outbound_emails o${composeWhere}`
  const replySql = sql`
    select r.id as id, 'reply' as kind, json_array(coalesce(r.to_address, ie.from_address)) as to_addresses, r.subject as subject,
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
