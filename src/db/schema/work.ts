// src/db/schema/work.ts
import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'

import { createdAt, nowMs, updatedAt, uuidPk } from './_shared.ts'
import { boardDocuments } from './board.ts'
import { memberProfiles } from './identity.ts'

/**
 * 이사회 업무툴 — 채팅(1단계). 원본은 kosmart-work Postgres `work.*` 표다(docs/board-work/01-설계.md §4).
 *
 * 옮기면서 바뀐 것:
 * - 표 이름에 `work_` 접두사(ggac `notifications`·`comments`와 겹치지 않게).
 * - 사람 FK는 `work.staff` 대신 `member_profiles`. 구성원 표는 따로 두지 않는다 — 이사회 권한이 정한다(§3).
 * - enum·CHECK는 DB에 두지 않는다(ggac 관례 — 펀딩·장터와 같다). 허용값과 길이는 각 영역의 zod 스키마(`src/work/lib/<영역>/schema.ts`)가 정본이다.
 * - 원본의 RLS·BEFORE 트리거(작성자 강제·특권 열 동결)·AFTER 트리거(답글 수·생성자 owner 등록·링크 추출)는
 *   **하나도 옮겨지지 않았다.** 그 규칙은 `src/db/queries/work/*`의 쓰기 함수가 같은 트랜잭션 안에서 지킨다(§5).
 * - 실시간 브로드캐스트 트리거 대신 `rev` 열(§6) — 폴링이 "무엇이 바뀌었나"를 이것으로 안다.
 *
 * 시각은 전부 epoch ms(`timestamp_ms`). 원본은 timestamptz다.
 */

/** 사용자별 설정 + 상태 메시지 — 원본 `staff_prefs`와 `staff`의 상태 열(0027)을 합쳤다. */
export const workMemberPrefs = sqliteTable('work_member_prefs', {
  userId: text('user_id')
    .primaryKey()
    .references(() => memberProfiles.id, { onDelete: 'cascade' }),
  /** 방해 금지. 분 단위(0~1439), 기본 22:00~08:00 */
  quietEnabled: integer('quiet_enabled', { mode: 'boolean' }).notNull().default(false),
  quietStart: integer('quiet_start').notNull().default(1320),
  quietEnd: integer('quiet_end').notNull().default(480),
  quietWeekends: integer('quiet_weekends', { mode: 'boolean' }).notNull().default(true),
  /** 'normal' | 'hourly' | 'off' */
  digestMode: text('digest_mode').notNull().default('off'),
  onboardedAt: integer('onboarded_at', { mode: 'timestamp_ms' }),
  /** 'section' | 'recent' */
  channelSort: text('channel_sort').notNull().default('section'),
  /** 'recent' | 'name' */
  chatSort: text('chat_sort').notNull().default('recent'),
  statusEmoji: text('status_emoji'),
  statusText: text('status_text'),
  statusUntil: integer('status_until', { mode: 'timestamp_ms' }),
  /**
   * 업무 화면에만 보이는 직함(0033). NULL이면 이사회 직함(`member_profiles.director_title`)이 보인다 —
   * `resolveWorkTitle`(src/work/lib/staff/work-title.ts). 공식 직함은 업무툴이 쓰지 않는다.
   */
  workTitle: text('work_title'),
  /**
   * 사용자 단위 변경 번호(§6) — 새 채널에 들어감·새 DM처럼 **사이드바 목록 자체**가 바뀔 때 올린다.
   * 원본 `user:<uid>` 토픽의 MEMBER_ADDED·DM_MESSAGE 신호 자리다.
   */
  membershipRev: integer('membership_rev').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const workChannelCategories = sqliteTable(
  'work_channel_categories',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex('work_channel_categories_name_key').on(sql`lower(trim(${table.name}))`),
    index('work_channel_categories_position_idx').on(table.position, table.createdAt),
  ]
)

export const workChannels = sqliteTable(
  'work_channels',
  {
    id: uuidPk(),
    /** 'public' | 'private' | 'dm' (그룹 채팅도 kind='dm' + is_group) */
    kind: text('kind').notNull().default('public'),
    /** 공개·비공개 채널만. DM은 null. 형식 `^[a-z0-9가-힣][a-z0-9가-힣_-]{0,79}$` */
    slug: text('slug'),
    name: text('name').notNull(),
    topic: text('topic'),
    createdBy: text('created_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** DM만. 1:1은 정렬된 `uid:uid`, 그룹은 `group:<id>` */
    dmKey: text('dm_key'),
    isGroup: integer('is_group', { mode: 'boolean' }).notNull().default(false),
    /** 그룹 채팅 이름(그룹만) */
    title: text('title'),
    /** 'everyone' | 'owners' — owners면 최상위 글은 채널 owner·관리자만 */
    postPolicy: text('post_policy').notNull().default('everyone'),
    categoryId: text('category_id').references(() => workChannelCategories.id, {
      onDelete: 'set null',
    }),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    /**
     * 채널 변경 번호(§6). 이 채널의 메시지·반응·답글 수가 바뀔 때마다 1 올리고, 바뀐 메시지의 `rev`를 같은 값으로 둔다.
     * 폴링은 "내가 본 rev보다 큰 메시지"만 다시 읽는다.
     */
    rev: integer('rev').notNull().default(0),
    /** 고정 메시지 목록이 바뀔 때 올린다(원본 pins 브로드캐스트 자리) */
    pinsRev: integer('pins_rev').notNull().default(0),
    /** 대화 탭·노트가 바뀔 때 올린다(원본 tabs 브로드캐스트 자리, 2단계) */
    tabsRev: integer('tabs_rev').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex('work_channels_slug_key').on(table.slug),
    uniqueIndex('work_channels_dm_key_key').on(table.dmKey),
    /** 원본 channels_name_active_uidx — 보관되지 않은 채널(DM 제외)의 이름은 대소문자·공백 무시하고 유일 */
    uniqueIndex('work_channels_name_active_uidx')
      .on(sql`lower(trim(${table.name}))`)
      .where(sql`"archived_at" is null and "kind" <> 'dm'`),
    index('work_channels_category_id_idx').on(table.categoryId),
  ]
)

export const workChannelMembers = sqliteTable(
  'work_channel_members',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    /** 'owner' | 'member' */
    role: text('role').notNull().default('member'),
    lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$defaultFn(() => new Date()),
    /** notify_level='off'와 늘 같게 둔다(원본 sync_member_notify_level 트리거 — 쓰기 함수가 맞춘다) */
    muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
    starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
    /** null | 'all' | 'mentions' | 'off' */
    notifyLevel: text('notify_level'),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$defaultFn(() => new Date()),
  },
  table => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    index('work_channel_members_user_idx').on(table.userId),
  ]
)

export const workMessages = sqliteTable(
  'work_messages',
  {
    /** 클라이언트가 미리 만든 uuid를 받는다(원본과 같다 — 재전송을 23505 대신 PK 충돌로 멱등 처리) */
    id: uuidPk(),
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    /** 스레드는 1단계 깊이(부모는 최상위·같은 채널) — 쓰기 함수가 지킨다 */
    parentId: text('parent_id').references((): AnySQLiteColumn => workMessages.id, {
      onDelete: 'cascade',
    }),
    authorId: text('author_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** 'text' | 'system' | 'bot' */
    kind: text('kind').notNull().default('text'),
    /** 최대 40000자 */
    body: text('body').notNull().default(''),
    attachmentsCount: integer('attachments_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    lastReplyAt: integer('last_reply_at', { mode: 'timestamp_ms' }),
    editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
    /** 소프트 삭제. 지우면 body를 비운다(원본 blank_deleted_message) */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    sensitive: integer('sensitive', { mode: 'boolean' }).notNull().default(false),
    quotedMessageId: text('quoted_message_id').references((): AnySQLiteColumn => workMessages.id, {
      onDelete: 'set null',
    }),
    forwardedFromId: text('forwarded_from_id').references((): AnySQLiteColumn => workMessages.id, {
      onDelete: 'set null',
    }),
    /** 마지막으로 바뀐 시점의 채널 rev(§6). 만들 때·고칠 때·지울 때·반응·답글 수가 바뀔 때 갱신 */
    rev: integer('rev').notNull().default(0),
    createdAt: createdAt(),
  },
  table => [
    index('work_messages_channel_timeline_idx')
      .on(table.channelId, sql`${table.createdAt} DESC`, sql`${table.id} DESC`)
      .where(sql`"parent_id" is null`),
    index('work_messages_thread_idx')
      .on(table.parentId, table.createdAt, table.id)
      .where(sql`"parent_id" is not null`),
    index('work_messages_author_idx').on(table.authorId),
    index('work_messages_channel_rev_idx').on(table.channelId, table.rev),
    index('work_messages_quoted_idx')
      .on(table.quotedMessageId)
      .where(sql`"quoted_message_id" is not null`),
    index('work_messages_forwarded_idx')
      .on(table.forwardedFromId)
      .where(sql`"forwarded_from_id" is not null`),
  ]
)

export const workReactions = sqliteTable(
  'work_reactions',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => workMessages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    /** 1~32자 */
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  table => [
    primaryKey({ columns: [table.messageId, table.userId, table.emoji] }),
    index('work_reactions_user_idx').on(table.userId),
  ]
)

export const workMentions = sqliteTable(
  'work_mentions',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => workMessages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
    /**
     * 멘션된 시각(0046). 메시지를 고쳐 나중에 넣은 멘션은 메시지 시각보다 늦다 — 멘션 메일(다이제스트)이 이 시각으로 고른다.
     * 0046 이전 행은 NULL(메시지 시각으로 본다).
     */
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  table => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    index('work_mentions_unread_idx')
      .on(table.userId)
      .where(sql`"read_at" is null`),
  ]
)

export const workBookmarks = sqliteTable(
  'work_bookmarks',
  {
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => workMessages.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  table => [
    primaryKey({ columns: [table.userId, table.messageId] }),
    index('work_bookmarks_message_idx').on(table.messageId),
  ]
)

export const workPins = sqliteTable(
  'work_pins',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => workMessages.id, { onDelete: 'cascade' }),
    pinnedBy: text('pinned_by').references(() => memberProfiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  table => [
    primaryKey({ columns: [table.channelId, table.messageId] }),
    index('work_pins_message_idx').on(table.messageId),
  ]
)

/** 메시지 본문의 링크(최대 20개) — 원본 sync_message_links 트리거 대신 쓰기 함수가 같은 트랜잭션에서 채운다 */
export const workMessageLinks = sqliteTable(
  'work_message_links',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => workMessages.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    /** 10~2000자 */
    url: text('url').notNull(),
    createdAt: createdAt(),
  },
  table => [
    primaryKey({ columns: [table.messageId, table.url] }),
    index('work_message_links_channel_idx').on(
      table.channelId,
      sql`${table.createdAt} DESC`,
      table.messageId
    ),
  ]
)

/** 받은 알림함 '새 활동'을 마지막으로 본 시각 */
export const workActivityReads = sqliteTable('work_activity_reads', {
  userId: text('user_id')
    .primaryKey()
    .references(() => memberProfiles.id, { onDelete: 'cascade' }),
  seenAt: integer('seen_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$defaultFn(() => new Date()),
})

/**
 * 접속 표시(원본 Realtime Presence `presence:workspace` 자리, §6).
 * 동기화 요청이 들어올 때 갱신한다(쓰기는 30초에 한 번으로 줄인다). 60초 안에 본 사람이 "접속 중".
 */
export const workPresence = sqliteTable('work_presence', {
  userId: text('user_id')
    .primaryKey()
    .references(() => memberProfiles.id, { onDelete: 'cascade' }),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
})

/**
 * 입력 중 표시(원본 Realtime broadcast `typing` 자리, §6). scope는 스레드 부모 메시지 id, 채널 본문이면 ''.
 * 5초 지난 행은 읽을 때 버리고, 쓸 때 덮어쓴다(지우는 크론은 두지 않는다 — 이사 20명 규모라 행이 쌓이지 않는다).
 */
export const workTyping = sqliteTable(
  'work_typing',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull().default(''),
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  table => [primaryKey({ columns: [table.channelId, table.scope, table.userId] })]
)

// ── 2단계(파일) — 설계 §4·§7 ─────────────────────────────────────────────────

/**
 * 메시지 전송 전 임시 업로드(원본 `pending_uploads`, 0003·0034). 원본은 `pending/` 객체를 최종 경로로 옮겼지만
 * 여기서는 **처음부터 최종 키**(`board-work/files/<uploadId>/<asciiSafeName>`)에 올리고, 승격은 이 행을 지우고
 * `work_attachments` 행을 만드는 DB 작업뿐이다(§7-1). 24시간 넘은 행과 그 객체는 정리 크론(5단계)이 지운다.
 */
export const workPendingUploads = sqliteTable(
  'work_pending_uploads',
  {
    /** 업로드 id — 객체 키의 한 구간이기도 하다 */
    id: uuidPk(),
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    uploaderId: text('uploader_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    /** 비공개 Blob 키(`board-work/files/…`). 서버가 정하고, 업로드 토큰은 이 키로만 발급한다 */
    blobPath: text('blob_path').notNull(),
    /** 표시 이름(1~255자, 한글 유지) */
    name: text('name').notNull(),
    mime: text('mime').notNull().default('application/octet-stream'),
    /** 브라우저가 알린 크기. 승격 때 `head()`의 실제 크기와 같아야 한다 */
    size: integer('size').notNull(),
    /** 문서 편집 초안 메타(원본 0034, 3단계). 일반 첨부는 null — 초안은 일반 첨부로 승격하지 않는다 */
    draftMeta: text('draft_meta', { mode: 'json' }),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex('work_pending_uploads_blob_path_key').on(table.blobPath),
    index('work_pending_uploads_created_idx').on(table.createdAt),
    index('work_pending_uploads_uploader_idx').on(table.uploaderId),
  ]
)

/**
 * 메시지 첨부(원본 `attachments`, 0001·0022·0032). 원본의 harden_attachments_write·is_latest 재계산 트리거는
 * 옮기지 않았다 — 쓰기 함수(`src/db/queries/work/files.ts`)가 같은 트랜잭션에서 메시지 첨부 수·rev를 맞춘다.
 * 버전 열(`previous_attachment_id`·`version_root_id`·`version_no`·`is_latest`)은 3단계(버전)가 표를 바꾸지 않게
 * 지금 만들어 둔다. 2단계에서는 모든 행이 v1(root null·no 1·latest true)이다.
 */
export const workAttachments = sqliteTable(
  'work_attachments',
  {
    id: uuidPk(),
    messageId: text('message_id')
      .notNull()
      .references(() => workMessages.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    uploaderId: text('uploader_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** 비공개 Blob 키. 읽기·삭제 전마다 `isSafeBoardWorkPath`로 다시 본다(원본 bucket_path 자리) */
    blobPath: text('blob_path').notNull(),
    /** 표시 이름(1~255자) */
    name: text('name').notNull(),
    mime: text('mime').notNull().default('application/octet-stream'),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** 채널 파일 탭 폴더(원본 0022). null = 최상위. 규칙은 `src/work/lib/files/folders.ts` */
    folderPath: text('folder_path'),
    previousAttachmentId: text('previous_attachment_id').references(
      (): AnySQLiteColumn => workAttachments.id,
      { onDelete: 'set null' }
    ),
    versionRootId: text('version_root_id').references((): AnySQLiteColumn => workAttachments.id, {
      onDelete: 'set null',
    }),
    versionNo: integer('version_no').notNull().default(1),
    isLatest: integer('is_latest', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex('work_attachments_blob_path_key').on(table.blobPath),
    index('work_attachments_message_idx').on(table.messageId),
    index('work_attachments_channel_idx').on(table.channelId, sql`${table.createdAt} DESC`),
    index('work_attachments_channel_latest_idx')
      .on(table.channelId, sql`${table.createdAt} DESC`)
      .where(sql`"is_latest" = 1`),
    index('work_attachments_folder_idx').on(table.channelId, table.folderPath),
    index('work_attachments_uploader_idx').on(table.uploaderId),
    /**
     * 같은 계보에 같은 번호는 하나(원본 attachments_lineage_version_uidx — 3단계의 동시 저장 경합 검출).
     * 계보 키는 coalesce(version_root_id, id)인데, drizzle-kit이 식 안의 쉼표를 열 구분으로 잘라서 CASE로 쓴다.
     */
    uniqueIndex('work_attachments_lineage_version_uidx').on(
      sql`(CASE WHEN ${table.versionRootId} IS NULL THEN ${table.id} ELSE ${table.versionRootId} END)`,
      table.versionNo
    ),
    index('work_attachments_previous_idx')
      .on(table.previousAttachmentId)
      .where(sql`"previous_attachment_id" is not null`),
    index('work_attachments_version_root_idx')
      .on(table.versionRootId)
      .where(sql`"version_root_id" is not null`),
  ]
)

/**
 * 파일 계보 1행(원본 `file_lineages`, 0032) — 최종본·"수정 중"(체크아웃). 계보 키 = v1 첨부 id.
 * 원본은 service_role 만 썼고(서버 액션이 권한 판정) 신호 트리거(채널 토픽)가 있었지만 받는 화면이 없어 옮기지 않았다.
 * 수정 중 만료는 조회 때 `checkout_until > 지금`으로 본다(크론 없음 — 원본과 같다).
 */
export const workFileLineages = sqliteTable(
  'work_file_lineages',
  {
    rootAttachmentId: text('root_attachment_id')
      .primaryKey()
      .references(() => workAttachments.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    finalAttachmentId: text('final_attachment_id').references(() => workAttachments.id, {
      onDelete: 'set null',
    }),
    finalMarkedBy: text('final_marked_by').references(() => memberProfiles.id, {
      onDelete: 'set null',
    }),
    finalMarkedAt: integer('final_marked_at', { mode: 'timestamp_ms' }),
    checkoutUserId: text('checkout_user_id').references(() => memberProfiles.id, {
      onDelete: 'set null',
    }),
    checkoutAt: integer('checkout_at', { mode: 'timestamp_ms' }),
    checkoutUntil: integer('checkout_until', { mode: 'timestamp_ms' }),
    updatedAt: updatedAt(),
  },
  table => [
    index('work_file_lineages_channel_idx').on(table.channelId),
    index('work_file_lineages_checkout_user_idx')
      .on(table.checkoutUserId)
      .where(sql`"checkout_user_id" is not null`),
    index('work_file_lineages_final_idx')
      .on(table.finalAttachmentId)
      .where(sql`"final_attachment_id" is not null`),
    index('work_file_lineages_final_marked_by_idx')
      .on(table.finalMarkedBy)
      .where(sql`"final_marked_by" is not null`),
  ]
)

// ── 4단계(본문 추출·검색) — 설계 §8-2·§8-3 ─────────────────────────────────────

/**
 * 첨부 문서 본문 추출 결과(원본 `attachment_texts`, 0029) — 첨부 1건에 1행. 추출 라우트
 * (`/api/internal/board-work/extract-texts`, CRON_SECRET)만 쓴다. 첨부가 지워지면 cascade.
 *
 * 원본과 다른 점:
 * - `ext`(소문자 확장자) 열을 더했다 — SQLite에는 정규식이 없어 이름에서 확장자를 뽑는 식을 SQL에 둘 수 없다
 *   (설계 §4). 추출 시점의 확장자를 남겨 두어 형식별 집계·재추출 대상 고르기에 쓴다.
 * - 상태·길이 CHECK(`status in (…)`, `char_length(content) <= 2000000`)는 DB에 두지 않는다(ggac 관례). 허용값과
 *   상한은 `src/work/lib/files/extract-text.ts`(EXTRACT_MAX_CHARS)와 쓰기 함수(`src/db/queries/work/texts.ts`)가 지킨다.
 * - pgroonga 전문 색인이 없다. 검색은 `instr(lower(content), lower(검색어))`다(§8-3 — FTS5는 나중).
 * - 원본 RLS(`attachment_texts_select` = 첨부를 읽을 수 있고 메시지가 살아 있음)는 검색 쿼리의 WHERE가 대신한다.
 */
export const workAttachmentTexts = sqliteTable(
  'work_attachment_texts',
  {
    attachmentId: text('attachment_id')
      .primaryKey()
      .references(() => workAttachments.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => workChannels.id, { onDelete: 'cascade' }),
    /** 소문자 확장자(점 없음, 없으면 '') */
    ext: text('ext').notNull().default(''),
    /** 검색용 평문(최대 2,000,000자 — 넘으면 앞부분만 두고 truncated) */
    content: text('content').notNull().default(''),
    truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
    /** 'ok' | 'unsupported' | 'failed' | 'too_large' */
    status: text('status').notNull(),
    extractorVersion: text('extractor_version').notNull(),
    /** 지금까지의 시도 횟수(선점할 때 1 오른다). failed 는 3회까지 다시 시도한다 */
    attempts: integer('attempts').notNull().default(1),
    extractedAt: integer('extracted_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowMs())
      .$defaultFn(() => new Date()),
  },
  table => [
    index('work_attachment_texts_channel_idx').on(table.channelId),
    /** 재시도 대상 조회(failed 만) */
    index('work_attachment_texts_failed_idx')
      .on(table.extractedAt)
      .where(sql`"status" = 'failed'`),
  ]
)

/**
 * 이사회 서류(`board_documents` — 서류함·정기총회 자료) 파일 본문 추출 결과(0034, 03 §10). 업무 검색의 '이사회 서류'
 * 묶음이 제목·파일 이름·`body_markdown`에 더해 이 본문에서도 찾는다. `work_attachment_texts`(0031)와 같은 모양·규칙이고
 * (상태·시도 횟수·재시도 간격 — `src/db/queries/work/boardDocumentTexts.ts`), 채널 열만 없다: 열람 범위는
 * **서류 행의 `visibility`**로 검색 쿼리가 WHERE 에서 건다. 서류를 지우면 행도 지워진다(ON DELETE CASCADE).
 */
export const workBoardDocumentTexts = sqliteTable(
  'work_board_document_texts',
  {
    documentId: text('document_id')
      .primaryKey()
      .references(() => boardDocuments.id, { onDelete: 'cascade' }),
    /** 소문자 확장자(점 없음, 없으면 '') */
    ext: text('ext').notNull().default(''),
    /** 검색용 평문(최대 2,000,000자 — 넘으면 앞부분만 두고 truncated) */
    content: text('content').notNull().default(''),
    truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
    /** 'ok' | 'unsupported' | 'failed' | 'too_large' */
    status: text('status').notNull(),
    extractorVersion: text('extractor_version').notNull(),
    /** 지금까지의 시도 횟수(선점할 때 1 오른다). failed 는 3회까지 다시 시도한다 */
    attempts: integer('attempts').notNull().default(1),
    extractedAt: integer('extracted_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowMs())
      .$defaultFn(() => new Date()),
  },
  table => [
    /** 재시도 대상 조회(failed 만) */
    index('work_board_document_texts_failed_idx')
      .on(table.extractedAt)
      .where(sql`"status" = 'failed'`),
  ]
)
