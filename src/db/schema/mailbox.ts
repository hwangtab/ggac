/**
 * 관리자 메일함 — Resend Inbound로 받은 메일을 우리가 보관한다.
 *
 * Resend는 받은 메일을 30일만 들고 있고 첨부 URL은 한 시간이면 만료된다.
 * 그래서 여기 있는 값이 정본이고 Resend는 배달 통로일 뿐이다.
 */
import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'

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
    /** 웹훅 `from` 원문. `홍길동 <hong@a.org>` 꼴일 수 있다 — 거르기에는 `fromEmail`을 쓴다. */
    fromAddress: text('from_address').notNull(),
    /** 소문자로 정규화한 발신 주소(`parseMailbox`, 기존 행은 0037이 백필). 발신자 필터는 완전 일치로 본다. */
    fromEmail: text('from_email'),
    /** 표시 이름. 없으면 null. */
    fromName: text('from_name'),
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
    /**
     * pending | done | attachments_failed | attachments_expired | failed
     * — 본문·첨부를 당겨왔는지.
     *
     * `attachments_failed`는 본문은 저장됐지만 첨부 중 일부/전부가 아직
     * 안 왔다는 뜻이다 — 백필 크론이 `pending`과 함께 다시 집어 재시도한다
     * (`listPendingInboundEmails`). Resend 보관 기한(30일)을 넘기고도 못
     * 채우면 `attachments_expired`로 끝낸다 — 본문은 살아 있으므로 `failed`
     * (본문 자체가 없다)와는 구분해 둔다.
     */
    bodyFetchStatus: text('body_fetch_status').notNull().default('pending'),
    /**
     * 대화 id — 대화를 시작한 받은 메일의 id(시작 메일은 자기 id). 새 행은 삽입 때 자기 id로 두고, 본문을 당겨
     * 헤더가 오면 `assignThread`가 앞 메일의 대화로 옮긴다. 기존 행은 0038이 백필했다.
     */
    threadId: text('thread_id'),
    /**
     * 담당자(0041) — 이 메일을 맡은 이사·감사·관리자. 지정·해제는 관리자만, 후보 판정은 라우트가 한다
     * (`canAccessBoardRoom`). 프로필이 지워지면 비운다.
     */
    assignedTo: text('assigned_to').references(() => memberProfiles.id, { onDelete: 'set null' }),
    assignedAt: integer('assigned_at', { mode: 'timestamp_ms' }),
    /** 지정한 관리자. 프로필이 지워지면 비운다. */
    assignedBy: text('assigned_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
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
    index('inbound_emails_from_email_idx').on(table.fromEmail, table.receivedAt),
    index('inbound_emails_thread_idx').on(table.threadId, table.receivedAt),
    index('inbound_emails_assigned_idx').on(table.assignedTo, table.receivedAt),
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
    /** 받는 사람(`Reply-To` 또는 원본 발신자). 0039 이전 행은 null — 그때는 원본 `from_address`로 갔다. */
    toAddress: text('to_address'),
    /** 전체 답장의 참조. JSON 배열 문자열. 없으면 null. */
    ccAddresses: text('cc_addresses'),
    /** 일일 한도에 센 수(to+cc, `@test.local` 제외). 0039 이전 행은 1. */
    recipientCount: integer('recipient_count').notNull().default(1),
    createdAt: createdAt(),
  },
  table => [index('inbound_email_replies_email_idx').on(table.emailId)]
)

/**
 * 관리자가 메일함에서 **새로 작성해** 보낸 메일(받은 메일에 대한 답장은 `inbound_email_replies`).
 *
 * 발송 **전에** `sending` 행을 먼저 쓴다. `idempotency_key`의 UNIQUE가 더블클릭·재전송의 중복
 * 발송을 막고, 일일 상한은 이 표의 합계로 센다. 함수가 발송 도중 죽어도 `sending` 행이 흔적으로 남는다.
 */
export const outboundEmails = sqliteTable(
  'outbound_emails',
  {
    id: uuidPk(),
    /** 클라이언트가 만든 UUID. 같은 작성 화면에서 온 요청을 한 건으로 묶는다. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    /** JSON 배열 문자열. */
    toAddresses: text('to_addresses').notNull(),
    ccAddresses: text('cc_addresses'),
    bccAddresses: text('bcc_addresses'),
    /** 중복을 걸러낸 to+cc+bcc 수. 일일 상한 합산에 쓴다. */
    recipientCount: integer('recipient_count').notNull(),
    subject: text('subject').notNull(),
    /** 정화한 뒤의 값. */
    bodyHtml: text('body_html').notNull(),
    sentBy: text('sent_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** 보낸 사람 프로필이 지워져도 누가 보냈는지 남긴다. */
    sentByEmail: text('sent_by_email'),
    /**
     * sending | sent | failed | unknown | blocked
     * - unknown: 타임아웃 등으로 Resend에 닿았는지 모른다. 다시 보내지 말고 Resend 대시보드로 확인한다.
     * - blocked: 일일 상한에 걸려 보내지 않았다.
     */
    status: text('status').notNull().default('sending'),
    /** @test.local 건너뛰기·응답 파싱 실패면 null. */
    resendMessageId: text('resend_message_id'),
    /** 200자로 자른 실패 사유. API 키는 들어가지 않는다. */
    error: text('error'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('outbound_emails_created_idx').on(table.createdAt),
    index('outbound_emails_status_idx').on(table.status),
    index('outbound_emails_sent_by_idx').on(table.sentBy),
  ]
)

export const outboundEmailAttachments = sqliteTable(
  'outbound_email_attachments',
  {
    id: uuidPk(),
    emailId: text('email_id')
      .notNull()
      .references(() => outboundEmails.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes').notNull(),
    /** 비공개 Blob 경로. `mailbox-sent/` 접두어 아래에만 존재한다. */
    blobPath: text('blob_path').notNull(),
    createdAt: createdAt(),
  },
  table => [index('outbound_email_attachments_email_idx').on(table.emailId)]
)

/**
 * 받은 메일의 **내부 메모** — 이사·감사·관리자가 메일마다 남기는 조합 안의 글. 메일로 나가지 않는다.
 *
 * 쓰기는 메일함 열람 범위(이사·감사·관리자) 전원, 고치기는 쓴 사람만, 지우기는 쓴 사람과 관리자다(라우트가 판정).
 * 발송 경로(답장·새 메일·전달)는 이 표를 읽는 쿼리를 들여오지 않는다 — 메모가 바깥으로 나갈 길을 코드 구조로 막는다.
 */
export const inboundEmailNotes = sqliteTable(
  'inbound_email_notes',
  {
    id: uuidPk(),
    emailId: text('email_id')
      .notNull()
      .references(() => inboundEmails.id, { onDelete: 'cascade' }),
    /** 쓴 사람. 프로필이 지워지면 null — 메모는 남기고 "탈퇴한 회원"으로 보인다. */
    authorId: text('author_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** 평문. 화면은 텍스트로만 그린다(HTML로 해석하지 않는다). 길이(1~2000자)는 라우트가 판정한다. */
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [index('inbound_email_notes_email_idx').on(table.emailId, table.createdAt)]
)

/**
 * 메일함 라벨 — 조합이 함께 쓰는 분류(총회·후원·언론 등). 만들기·고치기·지우기와 메일에 붙이기는 관리자만,
 * 보기·거르기는 이사·감사·관리자(라우트가 판정). 이름은 대소문자를 가리지 않고 겹칠 수 없다 — `lower(name)` 유일
 * 인덱스가 막는다(동시에 같은 이름을 만들어도 하나만 들어간다). 색은 정해진 팔레트의 키(`MAIL_LABEL_COLORS`)이고
 * 길이·색 판정은 라우트가 한다(0027과 같은 규칙으로 CHECK 없음).
 */
export const mailLabels = sqliteTable(
  'mail_labels',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    color: text('color').notNull().default('gray'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [uniqueIndex('mail_labels_name_idx').on(sql`lower(${table.name})`)]
)

/** 메일 ↔ 라벨. 메일이나 라벨이 지워지면 함께 지운다. */
export const inboundEmailLabels = sqliteTable(
  'inbound_email_labels',
  {
    emailId: text('email_id')
      .notNull()
      .references(() => inboundEmails.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => mailLabels.id, { onDelete: 'cascade' }),
    /** 붙인 사람. 프로필이 지워지면 비운다. */
    createdBy: text('created_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  table => [
    primaryKey({ columns: [table.emailId, table.labelId] }),
    index('inbound_email_labels_label_idx').on(table.labelId),
  ]
)

/**
 * 발신자 규칙 — 특정 주소·도메인에서 온 메일을 받는 즉시 스팸·보관 처리하거나 라벨을 붙인다. 관리자만 만든다
 * (라우트가 판정). 수신 웹훅이 메일을 저장한 뒤 응답 뒤에(`after`) 적용한다 — 실패해도 메일은 잃지 않는다.
 *
 * - `match_type`: `address`(정규화한 `from_email`과 완전 일치) | `domain`(`@` 뒤가 정확히 그 도메인 — 하위 도메인 제외)
 * - `action`: `spam` | `archive` | `label`(이때만 `label_id`가 있다. 라벨이 지워지면 규칙도 지운다)
 * - 같은 조건·동작·라벨의 규칙은 하나만 — 부분 유일 인덱스 둘
 */
export const mailSenderRules = sqliteTable(
  'mail_sender_rules',
  {
    id: uuidPk(),
    matchType: text('match_type').notNull(),
    matchValue: text('match_value').notNull(),
    action: text('action').notNull(),
    labelId: text('label_id').references(() => mailLabels.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  // 같은 규칙은 하나만. 라벨 없는 규칙과 라벨 규칙을 부분 인덱스 둘로 나눈다 — NULL은 유일 인덱스에서 서로 다른
  // 값으로 쳐서 한 인덱스로는 라벨 없는 규칙의 중복을 못 막는다(drizzle-kit은 `ifnull(…, '')` 같은 식을 쪼갠다).
  table => [
    uniqueIndex('mail_sender_rules_plain_idx')
      .on(table.matchType, table.matchValue, table.action)
      .where(sql`${table.labelId} is null`),
    uniqueIndex('mail_sender_rules_label_idx')
      .on(table.matchType, table.matchValue, table.action, table.labelId)
      .where(sql`${table.labelId} is not null`),
  ]
)
