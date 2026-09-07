/**
 * 관리자 메일함 — Resend Inbound로 받은 메일을 우리가 보관한다.
 *
 * Resend는 받은 메일을 30일만 들고 있고 첨부 URL은 한 시간이면 만료된다.
 * 그래서 여기 있는 값이 정본이고 Resend는 배달 통로일 뿐이다.
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

import { uuidPk, createdAt, updatedAt } from './_shared.ts'
import { memberProfiles } from './identity.ts'

export const inboundEmails = sqliteTable(
  'inbound_emails',
  {
    id: uuidPk(),
    /** Resend가 매긴 id. 웹훅 재전송을 걸러내는 멱등성 키다. */
    resendEmailId: text('resend_email_id').notNull().unique(),
    /** `<...@...>` 형식. 답장의 In-Reply-To에 그대로 넣는다. */
    messageId: text('message_id'),
    fromAddress: text('from_address').notNull(),
    /** JSON 배열 문자열. */
    toAddresses: text('to_addresses').notNull(),
    ccAddresses: text('cc_addresses'),
    /** JSON 배열 문자열. 허용 주소 판정의 대상이다. */
    receivedFor: text('received_for'),
    subject: text('subject'),
    bodyHtml: text('body_html'),
    bodyText: text('body_text'),
    /** JSON 객체 문자열. */
    headers: text('headers'),
    /** unread | read | replied | archived | spam */
    status: text('status').notNull().default('unread'),
    /** pending | done | failed — 본문·첨부를 당겨왔는지. */
    bodyFetchStatus: text('body_fetch_status').notNull().default('pending'),
    /** 답장 스레드용 References 누적. 공백으로 이은 message_id 목록. */
    threadReferences: text('thread_references'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('inbound_emails_status_idx').on(table.status),
    index('inbound_emails_received_idx').on(table.receivedAt),
    index('inbound_emails_from_idx').on(table.fromAddress),
    index('inbound_emails_fetch_status_idx').on(table.bodyFetchStatus),
  ]
)

export const inboundEmailAttachments = sqliteTable(
  'inbound_email_attachments',
  {
    id: uuidPk(),
    emailId: text('email_id')
      .notNull()
      .references(() => inboundEmails.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type'),
    /** 인라인 이미지의 cid: 참조와 대응한다. */
    contentId: text('content_id'),
    sizeBytes: integer('size_bytes'),
    /** 비공개 Blob 경로. `mailbox/` 접두어 아래에만 존재한다. */
    blobPath: text('blob_path').notNull(),
    createdAt: createdAt(),
  },
  table => [index('inbound_email_attachments_email_idx').on(table.emailId)]
)

export const inboundEmailReplies = sqliteTable(
  'inbound_email_replies',
  {
    id: uuidPk(),
    emailId: text('email_id')
      .notNull()
      .references(() => inboundEmails.id, { onDelete: 'cascade' }),
    sentBy: text('sent_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    resendMessageId: text('resend_message_id'),
    createdAt: createdAt(),
  },
  table => [index('inbound_email_replies_email_idx').on(table.emailId)]
)
