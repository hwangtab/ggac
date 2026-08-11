import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared'
import { memberProfiles } from './identity'

export const SETTING_CATEGORY = [
  'notification',
  'privacy',
  'interface',
  'security',
  'preference',
] as const

export const SYSTEM_SETTING_CATEGORY = ['site', 'email', 'security', 'features'] as const

export const ACTIVITY_ACTION_TYPE = [
  'login',
  'logout',
  'post_created',
  'post_updated',
  'post_deleted',
  'comment_created',
  'comment_deleted',
  'like_added',
  'like_removed',
  'profile_updated',
  'password_changed',
  'email_changed',
  'artist_profile_updated',
  'member_approved',
  'member_rejected',
  'admin_action',
  'file_uploaded',
  'file_deleted',
  'notification_read',
  'search_performed',
  'page_viewed',
] as const

export const ACTIVITY_TARGET_TYPE = [
  'post',
  'comment',
  'user',
  'profile',
  'artist_profile',
  'file',
  'notification',
  'system',
] as const

export const systemSettings = sqliteTable(
  'system_settings',
  {
    id: uuidPk(),
    category: text('category', { enum: SYSTEM_SETTING_CATEGORY }).notNull(),
    settingKey: text('setting_key').notNull(),
    settingValue: text('setting_value', { mode: 'json' }).$type<unknown>().notNull().default({}),
    description: text('description'),
    isSensitive: integer('is_sensitive', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: text('updated_by').references(() => memberProfiles.id),
  },
  table => [uniqueIndex('system_settings_category_key_idx').on(table.category, table.settingKey)]
)

export const defaultSettings = sqliteTable(
  'default_settings',
  {
    id: uuidPk(),
    category: text('category', { enum: SETTING_CATEGORY }).notNull(),
    settingKey: text('setting_key').notNull(),
    defaultValue: text('default_value', { mode: 'json' }).$type<unknown>().notNull().default({}),
    description: text('description'),
    isRequired: integer('is_required', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  table => [uniqueIndex('default_settings_category_key_idx').on(table.category, table.settingKey)]
)

export const userSettings = sqliteTable(
  'user_settings',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    category: text('category', { enum: SETTING_CATEGORY }).notNull(),
    settingKey: text('setting_key').notNull(),
    settingValue: text('setting_value', { mode: 'json' }).$type<unknown>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex('user_settings_user_category_key_idx').on(
      table.userId,
      table.category,
      table.settingKey
    ),
  ]
)

export const userActivities = sqliteTable('user_activities', {
  id: uuidPk(),
  userId: text('user_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
  actionType: text('action_type', { enum: ACTIVITY_ACTION_TYPE }).notNull(),
  targetType: text('target_type', { enum: ACTIVITY_TARGET_TYPE }),
  targetId: text('target_id'),
  metadata: text('metadata', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  /** Postgres inet → text */
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  /** 세션 추적은 폐기했지만 컬럼은 과거 데이터 이관을 위해 유지한다. */
  sessionId: text('session_id'),
  createdAt: createdAt(),
})

export const linkPreviews = sqliteTable('link_previews', {
  /** Postgres에서도 url이 PK다. */
  url: text('url').primaryKey(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  lastFetched: integer('last_fetched', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  ttlSeconds: integer('ttl_seconds').notNull().default(21600),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const eventApplications = sqliteTable('event_applications', {
  id: uuidPk(),
  eventSlug: text('event_slug').notNull(),
  applicantName: text('applicant_name').notNull(),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  performanceInfo: text('performance_info'),
  itemsToSell: text('items_to_sell'),
  links: text('links'),
  message: text('message'),
  status: text('status').notNull().default('pending'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  privacyConsent: integer('privacy_consent', { mode: 'boolean' }).notNull().default(false),
  privacyConsentAt: integer('privacy_consent_at', { mode: 'timestamp_ms' }),
  participationType: text('participation_type'),
  photoUrl: text('photo_url'),
})

export const memberBulkOperations = sqliteTable('member_bulk_operations', {
  id: uuidPk(),
  operationType: text('operation_type').notNull(),
  performedBy: text('performed_by')
    .notNull()
    .references(() => memberProfiles.id),
  /** Postgres uuid[] → JSON 배열 */
  memberIds: text('member_ids', { mode: 'json' }).$type<string[]>().notNull(),
  parameters: text('parameters', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  results: text('results', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull().default('pending'),
  createdAt: createdAt(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  errorMessage: text('error_message'),
})
