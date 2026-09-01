import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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

export const posts = sqliteTable(
  'posts',
  {
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
  },
  table => [
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_posts_keyset_pagination').on(
      table.isDeleted,
      sql`\`is_pinned\` DESC`,
      sql`\`created_at\` DESC`,
      sql`\`id\` DESC`
    ),
    index('idx_posts_category_keyset_pagination').on(
      table.isDeleted,
      table.category,
      sql`\`is_pinned\` DESC`,
      sql`\`created_at\` DESC`,
      sql`\`id\` DESC`
    ),
    index('idx_posts_author_id').on(table.authorId, table.isDeleted, sql`\`created_at\` DESC`),
    index('idx_posts_created_at_not_deleted').on(table.isDeleted, sql`\`created_at\` DESC`),
  ]
)

export const comments = sqliteTable(
  'comments',
  {
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
  },
  table => [
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_comments_post_id_created_at').on(table.postId, table.createdAt, table.id),
    index('idx_comments_author_id').on(table.authorId, sql`\`created_at\` DESC`),
  ]
)

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
  table => [
    uniqueIndex('post_likes_post_user_idx').on(table.postId, table.userId),
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_post_likes_user_post').on(table.userId, table.postId),
  ]
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
  table => [
    uniqueIndex('comment_likes_comment_user_idx').on(table.commentId, table.userId),
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_comment_likes_user_comment').on(table.userId, table.commentId),
  ]
)

export const postAttachments = sqliteTable(
  'post_attachments',
  {
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
  },
  table => [
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_post_attachments_post_sort').on(table.postId, table.sortOrder),
    index('idx_post_attachments_temp_cleanup').on(table.isTemporary, table.expiresAt),
  ]
)

export const notifications = sqliteTable(
  'notifications',
  {
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
  },
  table => [
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_notifications_user_created_at').on(table.userId, sql`\`created_at\` DESC`),
    index('idx_notifications_read_status').on(table.userId, table.readAt),
  ]
)
