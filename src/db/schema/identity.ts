import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'

export const REGISTRATION_STATUS = ['pending', 'approved', 'rejected'] as const

export const memberProfiles = sqliteTable(
  'member_profiles',
  {
    // Better Auth user.id와 동일한 UUID를 쓴다. 기본값 없음 — 가입 흐름이 명시 지정.
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    phoneNumber: text('phone_number'),
    /** date 전용 컬럼: 타임존 해석을 피하려고 'YYYY-MM-DD' 문자열로 저장한다. */
    birthDate: text('birth_date'),
    realName: text('real_name'),
    monthlyFee: integer('monthly_fee'),
    bankName: text('bank_name'),
    accountNumber: text('account_number'),
    accountHolder: text('account_holder'),
    registrationStatus: text('registration_status', { enum: REGISTRATION_STATUS })
      .notNull()
      .default('pending'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    approvedBy: text('approved_by'),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
    rejectedBy: text('rejected_by'),
    suspensionReason: text('suspension_reason'),
    suspensionUntil: integer('suspension_until', { mode: 'timestamp_ms' }),
    isSuspended: integer('is_suspended', { mode: 'boolean' }).notNull().default(false),
    profileCompletenessScore: integer('profile_completeness_score').notNull().default(0),
    verificationStatus: text('verification_status', { mode: 'json' })
      .$type<{ email: boolean; phone: boolean; identity: boolean }>()
      .notNull()
      .default({ email: false, phone: false, identity: false }),
    membershipType: text('membership_type').notNull().default('regular'),
    engagementScore: integer('engagement_score').notNull().default(0),
    isMember: integer('is_member', { mode: 'boolean' }).notNull().default(true),
    /**
     * Postgres에서도 uuid가 아니라 text다. **`artists.id`가 아니라
     * `artists.legacy_id`를 담는다** — 실측(2026-08-18) 결과 값이 있는 15행은
     * 전부 `artist-014` 같은 legacy_id였고, 그중 `artist-002`·`artist-003`·
     * `artist-017` 3건은 대상 아티스트가 없다(끊어진 참조). 조인하는 코드는
     * 없고 admin/members/components/MemberDetailModal.tsx가 문자열을 그대로
     * 화면에 찍는 것이 전부다. 이관도 원문 그대로 옮긴다.
     */
    artistId: text('artist_id'),
    isArtist: integer('is_artist', { mode: 'boolean' }).notNull().default(false),
    artistRole: text('artist_role').notNull().default('owner'),
    isDirector: integer('is_director', { mode: 'boolean' }).notNull().default(false),
    directorTitle: text('director_title'),
    isAuditor: integer('is_auditor', { mode: 'boolean' }).notNull().default(false),
    /**
     * 탈퇴가 확정된 시각. `registration_status = 'withdrawn'`인 행에만 있다.
     * 신청 단계(`withdrawal_requested`)에서는 아직 NULL이다.
     */
    withdrawnAt: integer('withdrawn_at', { mode: 'timestamp_ms' }),
  },
  // Postgres 원본도 email에 UNIQUE 제약이 있다(20250106090010_init_member_profiles.sql:18).
  table => [
    uniqueIndex('member_profiles_email_idx').on(table.email),
    /**
     * 성능 인덱스 — 정의의 정본은 `0004_add_performance_indexes.sql`이고, 운영 DB에
     * 이미 같은 이름·같은 컬럼으로 존재한다. 여기 선언하는 이유는 **`drizzle-kit
     * push`가 스키마에 없는 인덱스를 "잉여"로 보고 지우기 때문**이다(적대 감사
     * 2026-08-27 실측: 23 → 0, 질의 계획이 SEARCH → SCAN). 지우지 말 것 —
     * `scripts/testing/performanceIndexDeclarations.test.mjs`가 못박고 있다.
     *
     * DESC는 `sql` 템플릿으로 쓴다. 이 Drizzle 버전에는 `column.desc()`가 없다.
     */
    index('idx_member_profiles_status').on(table.registrationStatus, sql`\`created_at\` DESC`),
    index('idx_member_profiles_created_at').on(sql`\`created_at\` DESC`),
    index('idx_member_profiles_artist_id').on(table.artistId),
  ]
)

export const artists = sqliteTable('artists', {
  id: uuidPk(),
  legacyId: text('legacy_id').notNull().unique(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  /** Postgres text[] → JSON 배열 */
  category: text('category', { mode: 'json' }).$type<string[]>(),
  oneLiner: text('one_liner'),
  bio: text('bio'),
  templateType: text('template_type').default('콜라주형'),
  portfolioLinks: text('portfolio_links', { mode: 'json' })
    .$type<unknown[]>()
    .notNull()
    .default([]),
  youtubeVideos: text('youtube_videos', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
  contact: text('contact'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  profilePhotoUrl: text('profile_photo_url'),
  profilePhotoMetadata: text('profile_photo_metadata', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  nameEn: text('name_en'),
  oneLinerEn: text('one_liner_en'),
  bioEn: text('bio_en'),
  templateTypeEn: text('template_type_en'),
})
