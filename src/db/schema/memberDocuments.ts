// src/db/schema/memberDocuments.ts
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, nowMs, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

/**
 * 조합원 '내 문서함'(docs/board-work/04-조합원-문서함.md §2). 마이그레이션 0035.
 *
 * 업무툴 표(0027~0034)와 같은 규칙: 사람 FK는 `member_profiles`, enum·CHECK 없음(허용값은
 * `src/lib/memberDocuments/rules.ts`와 쿼리 계층이 지킨다), 시각은 epoch ms.
 *
 * **소유 경계는 DB에 없다.** 모든 읽기·쓰기 함수(`src/db/queries/memberDocuments.ts`)가 `owner_id`를 인자로 받아
 * WHERE 에 넣는다 — 라우트가 `requireActiveMember()`로 확정한 사용자 id 다. 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
 */

/** 문서 한 건 — 이름·최신 버전 번호·보존 상태 */
export const memberDocuments = sqliteTable(
  'member_documents',
  {
    id: uuidPk(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    /** 표시 이름(확장자 포함, 1~255자). 이름 바꾸기가 고치는 곳 */
    name: text('name').notNull(),
    /** 최신 버전 번호. 버전 행의 `version_no`와 짝이다 */
    latestVersionNo: integer('latest_version_no').notNull().default(1),
    /** 열거나 고친 때 — 보존 판정(1년)의 기준 */
    lastOpenedAt: integer('last_opened_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowMs())
      .$defaultFn(() => new Date()),
    /** 1년 미사용 알림을 보낸 때. 열면 NULL로 되돌린다. 알린 지 30일이 지나도 안 열었으면 지운다 */
    deletionNotifiedAt: integer('deletion_notified_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index('member_documents_owner_idx').on(table.ownerId, table.updatedAt),
    index('member_documents_last_opened_idx').on(table.lastOpenedAt),
  ]
)

/** 버전 한 벌 = 비공개 Blob 객체 하나. id 는 객체 키의 업로드 id 구간이자 미리보기 캐시 키다 */
export const memberDocumentVersions = sqliteTable(
  'member_document_versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => memberDocuments.id, { onDelete: 'cascade' }),
    /** 사용량 합계·소유 재확인용(문서의 owner_id 와 같다) */
    ownerId: text('owner_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull().default('application/octet-stream'),
    size: integer('size').notNull(),
    /** `member-documents/<ownerId>/<id>/<안전 이름>` — `isSafeMemberDocumentPath` 를 지나야 한다 */
    blobPath: text('blob_path').notNull(),
    /** 'upload' | 'editor' | 'restore' */
    source: text('source').notNull().default('upload'),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex('member_document_versions_doc_no_key').on(table.documentId, table.versionNo),
    uniqueIndex('member_document_versions_blob_path_key').on(table.blobPath),
    index('member_document_versions_owner_idx').on(table.ownerId),
  ]
)

/**
 * 임시 업로드 — 업로드 토큰 발급의 근거(업무툴 `work_pending_uploads`와 같은 자리). 승격하면 이 id 가 버전 id 가 되고
 * 행은 지운다. 24시간 안의 행은 사용량에 자리를 잡는다. 정리는 보존 크론이 한다.
 */
export const memberDocumentUploads = sqliteTable(
  'member_document_uploads',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    /** 새 버전으로 올리는 대상 문서. 새 문서면 NULL */
    documentId: text('document_id').references(() => memberDocuments.id, {
      onDelete: 'cascade',
    }),
    blobPath: text('blob_path').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull().default('application/octet-stream'),
    /** 브라우저가 알린 크기. 승격 때 `head()`의 실제 크기와 같아야 한다 */
    size: integer('size').notNull(),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex('member_document_uploads_blob_path_key').on(table.blobPath),
    index('member_document_uploads_owner_idx').on(table.ownerId),
    index('member_document_uploads_created_idx').on(table.createdAt),
  ]
)
