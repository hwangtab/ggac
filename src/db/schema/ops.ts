import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

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

/**
 * 단계 4: 시스템 설정 변경 히스토리 테이블(운영 실측 4행).
 * Postgres 원본(20250721090010_create_system_settings.sql)은 setting_id·
 * old_value·new_value·changed_by·change_reason을 전부 nullable로 선언한다
 * — UPDATE 트리거가 채우는 감사 로그라 실측 4행 모두 changed_by/change_reason이
 * NULL이었다(서비스 롤 컨텍스트에는 auth.uid()가 없다).
 */
export const systemSettingsHistory = sqliteTable('system_settings_history', {
  id: uuidPk(),
  settingId: text('setting_id').references(() => systemSettings.id, { onDelete: 'cascade' }),
  category: text('category', { enum: SYSTEM_SETTING_CATEGORY }).notNull(),
  settingKey: text('setting_key').notNull(),
  oldValue: text('old_value', { mode: 'json' }).$type<unknown>(),
  newValue: text('new_value', { mode: 'json' }).$type<unknown>(),
  changedBy: text('changed_by').references(() => memberProfiles.id),
  changedAt: integer('changed_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  changeReason: text('change_reason'),
})

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

export const userActivities = sqliteTable(
  'user_activities',
  {
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
    index('idx_user_activities_created_at').on(sql`\`created_at\` DESC`),
    index('idx_user_activities_composite').on(
      table.userId,
      table.actionType,
      sql`\`created_at\` DESC`
    ),
  ]
)

/**
 * 단계 4: 실시간 사용자 세션 추적 테이블(운영 실측 5937행).
 * Postgres 원본(20250719090020_create_activity_tracking_system.sql)은
 * user_id를 nullable로 선언한다 — NOT NULL이 아니다.
 */
export const userSessions = sqliteTable(
  'user_sessions',
  {
    id: uuidPk(),
    userId: text('user_id').references(() => memberProfiles.id, { onDelete: 'cascade' }),
    sessionToken: text('session_token').notNull().unique(),
    lastActivity: integer('last_activity', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** Postgres inet → text */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    loginAt: integer('login_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    logoutAt: integer('logout_at', { mode: 'timestamp_ms' }),
    metadata: text('metadata', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
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
    index('idx_user_sessions_user_active').on(table.userId, table.isActive),
    index('idx_user_sessions_active_last_activity').on(table.isActive, table.lastActivity),
    index('idx_user_sessions_last_activity').on(table.lastActivity),
  ]
)

/**
 * 단계 4: 일별 활동 통계 집계 테이블(운영 실측 865행).
 * activity_date는 date 전용 컬럼 — 타임존 해석을 피하려고 'YYYY-MM-DD'
 * 문자열로 저장한다(identity.ts의 birthDate와 같은 관례).
 */
export const dailyActivityStats = sqliteTable(
  'daily_activity_stats',
  {
    id: uuidPk(),
    activityDate: text('activity_date').notNull(),
    userId: text('user_id').references(() => memberProfiles.id, { onDelete: 'cascade' }),
    actionType: text('action_type', { enum: ACTIVITY_ACTION_TYPE }).notNull(),
    count: integer('count').notNull().default(0),
    lastUpdated: integer('last_updated', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    uniqueIndex('daily_activity_stats_date_user_action_idx').on(
      table.activityDate,
      table.userId,
      table.actionType
    ),
  ]
)

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
