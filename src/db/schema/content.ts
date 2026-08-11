import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared'
import { memberProfiles } from './identity'

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
