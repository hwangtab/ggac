import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

export const NOTIFICATION_TYPE = [
  'post_new',
  'post_reply',
  'post_mention',
  'member_approved',
  'member_rejected',
  'artist_approved',
  'artist_rejected',
  'system_notice',
  'maintenance',
  'welcome',
  'board_notice',
] as const

export const posts = sqliteTable('posts', {
  id: uuidPk(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  category: text('category').notNull().default('잡담'),
  authorId: text('author_id')
    .notNull()
    .references(() => memberProfiles.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  pinnedAt: integer('pinned_at', { mode: 'timestamp_ms' }),
  contentFormat: text('content_format').notNull().default('plain'),
  likeCount: integer('like_count').notNull().default(0),
  viewCount: integer('view_count').notNull().default(0),
})

export const comments = sqliteTable('comments', {
  id: uuidPk(),
  postId: text('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  authorId: text('author_id')
    .notNull()
    .references(() => memberProfiles.id),
  content: text('content').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  likeCount: integer('like_count').notNull().default(0),
})

export const postLikes = sqliteTable(
  'post_likes',
  {
    id: uuidPk(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  table => [uniqueIndex('post_likes_post_user_idx').on(table.postId, table.userId)]
)

export const commentLikes = sqliteTable(
  'comment_likes',
  {
    id: uuidPk(),
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  table => [uniqueIndex('comment_likes_comment_user_idx').on(table.commentId, table.userId)]
)

export const postAttachments = sqliteTable('post_attachments', {
  id: uuidPk(),
  postId: text('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  fileUrl: text('file_url').notNull(),
  fileType: text('file_type').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  altText: text('alt_text'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  isTemporary: integer('is_temporary', { mode: 'boolean' }).notNull().default(false),
  tempSession: text('temp_session'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
})

export const notifications = sqliteTable('notifications', {
  id: uuidPk(),
  userId: text('user_id')
    .notNull()
    .references(() => memberProfiles.id, { onDelete: 'cascade' }),
  type: text('type', { enum: NOTIFICATION_TYPE }).notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  readAt: integer('read_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  relatedPostId: text('related_post_id'),
  relatedUserId: text('related_user_id'),
})

/**
 * `publishing`은 발행 중(claim됨, `runGrantPublish` 진행 중) 상태다. DDL은 바뀌지 않는다 —
 * 컬럼이 `text NOT NULL DEFAULT 'draft'`이고 CHECK 제약이 없어(0010_fat_cassandra_nova.sql)
 * 앱 레벨 유니온만 넓히면 된다. 발행 API의 동시 요청 경쟁(TOCTOU) 차단용 —
 * `claimGrantDigestForPublish`가 `draft → publishing`으로 조건부 선점하고, 발행이 끝나면
 * `published`로, 실패하면 `draft`로 되돌린다(src/app/api/admin/grants/[id]/publish/route.ts).
 */
export const GRANT_DIGEST_STATUS = ['draft', 'publishing', 'published', 'discarded'] as const

/**
 * 예술지원사업 주간 회차. 공고 원장은 kosmart가 소유하고 우리는 **보낸 것만** 남긴다.
 *
 * 공고 미러 테이블을 두지 않는 이유: 발행된 내용은 게시글이 아카이브이고, 중복 제거는
 * 최근 몇 주 회차의 `items`만 보면 된다. 미러를 두면 kosmart와의 동기화 상태(삭제·마감·
 * 태그 수정)를 계속 맞춰야 하는데 조합원 18명 규모에 그 기계를 유지할 이유가 없다.
 */
export const grantDigests = sqliteTable(
  'grant_digests',
  {
    id: uuidPk(),
    /** ISO 주차 'YYYY-Www'. 회차 멱등키 — 크론이 두 번 돌아도 회차는 하나다. */
    weekKey: text('week_key').notNull(),
    /** GrantItem[] 스냅샷. 관리자가 제외·추가한 결과까지 반영된 최종본. */
    items: text('items', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
    status: text('status', { enum: GRANT_DIGEST_STATUS }).notNull().default('draft'),
    /** 발행된 게시글 id. 발행 전에는 null. */
    postId: text('post_id'),
    createdAt: createdAt(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
  },
  table => ({
    weekKeyIdx: uniqueIndex('grant_digests_week_key_idx').on(table.weekKey),
  })
)
