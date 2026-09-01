/**
 * `member_profiles` 쿼리 계층 (Turso/Drizzle).
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정(로그인 여부,
 * 활성 회원 여부, 관리자 여부)은 호출부(라우트의 `requireUser()`·
 * `requireActiveMember()`·`requireAdmin()` 등)의 몫이고, 이 모듈의 모든
 * 함수는 **이미 검증된 `id`/`userId`를 인자로만** 받는다. 이 경계 덕분에
 * 이 모듈은 인증 미들웨어 없이도 순수 유닛 테스트로 검증할 수 있다
 * (`scripts/testing/queriesProfiles.test.mjs`).
 *
 * 응답 형태(`ProfileRow`)는 snake_case다. Drizzle는 camelCase 컬럼명을
 * 돌려주지만, 이 프로젝트의 API 응답 본문은 Supabase 시절부터 snake_case
 * 키를 프런트가 그대로 읽는다 — `strict: false`라 키가 바뀌어도 타입
 * 검사가 못 잡고 화면이 조용히 빈다(CLAUDE.md).
 */

import { and, asc, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import { db } from '../client.ts'
import { memberProfiles, user } from '../schema/index.ts'

import type { ArtistRole, MembershipType } from '../../constants/memberProfile.ts'

import { toCamelCase, toIso } from './_helpers.ts'
import { profileCompletenessExpression } from './profileCompleteness.ts'

export type RegistrationStatus = 'pending' | 'approved' | 'rejected'

/** API 응답에 쓰이는 snake_case 정규화 형태. 컬럼 33개 전부를 담는다. */
export interface ProfileRow {
  id: string
  display_name: string
  email: string
  phone_number: string | null
  birth_date: string | null
  real_name: string | null
  monthly_fee: number | null
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  registration_status: RegistrationStatus
  is_active: boolean
  is_admin: boolean
  created_at: string
  updated_at: string
  approved_at: string | null
  approved_by: string | null
  last_login_at: string | null
  rejected_by: string | null
  suspension_reason: string | null
  suspension_until: string | null
  is_suspended: boolean
  profile_completeness_score: number
  verification_status: { email: boolean; phone: boolean; identity: boolean }
  /** 사라진 `member_profiles_membership_type_check`의 타입 재현 —
   * 런타임 쓰기 경로가 없어 검사할 자리가 없는 대신 타입이 막는다. */
  membership_type: MembershipType
  engagement_score: number
  is_member: boolean
  artist_id: string | null
  is_artist: boolean
  /** 사라진 `check_artist_role`의 타입 재현. 런타임 검사는
   * `isValidArtistRole`(admin 아티스트 배정 라우트)이 한다. */
  artist_role: ArtistRole
  is_director: boolean
  director_title: string | null
  is_auditor: boolean
}

/**
 * `upsertProfile`/`updateProfile`에 쓰는 쓰기 입력. `ProfileRow`와 같은
 * snake_case 키를 쓴다 — 호출부(가입 훅·member-signup 라우트·향후 admin
 * 라우트)가 이미 그 모양으로 행을 조립하고 있었다
 * (`src/lib/auth/profileHook.ts`의 `buildMemberProfileRow`,
 * `src/lib/auth/signupProfile.ts`의 `buildSignupProfileRow`). 타임스탬프
 * 컬럼(`approved_at`·`last_login_at`·`suspension_until`)은 ISO 문자열 또는
 * null로 넘긴다 — 이 모듈이 내부적으로 Date로 변환해 Drizzle에 넘긴다.
 */
export type ProfileWriteInput = Partial<Omit<ProfileRow, 'created_at' | 'updated_at'>>

/** `upsertProfile`은 최소 이 세 필드를 요구한다 — DB에 기본값이 없는 NOT NULL 컬럼이다. */
export type UpsertProfileInput = ProfileWriteInput & {
  id: string
  email: string
  display_name: string
}

export type ProfilePatch = Omit<ProfileWriteInput, 'id'>

/**
 * `listProfiles`에 상태/불리언 필터가 없어 "전체를 한 번에 받아 메모리에서
 * 거른다" 패턴을 쓰는 호출부(admin/artists 목록, admin/artists/members
 * 목록, admin/members/stats)가 공유하는 상한. 회원 23명 기준으로는 사실상
 * "전체 조회"를 흉내내지만, **실제 회원 수가 이 값을 넘으면 나머지는
 * 조용히 잘린다** — 에러가 나지 않는다. 이 값을 늘려야 할 정도로 회원이
 * 늘면(코멘트 관례상 "수천 명대"), `listProfiles`에 필요한 필터(예:
 * `is_artist`/`is_active`)를 추가하는 편이 낫다. (`src/lib/server/
 * boardRoomAuth.ts`의 `APPROVED_ROSTER_PAGE_LIMIT`는 같은 값을 쓰지만
 * Task 3b가 만든 독립 상수라 이번엔 건드리지 않았다.)
 */
export const ALL_PROFILES_LIMIT = 10000

export interface ListProfilesFilter {
  /** 생략하면 전체 상태를 대상으로 한다. */
  status?: RegistrationStatus
  /** display_name/email/real_name 부분일치 검색 (SQLite LIKE — 영문 대소문자만 무시). */
  search?: string
  limit: number
  offset: number
}

type MemberProfileSelectRow = typeof memberProfiles.$inferSelect

/** DB 컬럼 중 ISO 문자열로 주고받는 timestamp_ms 컬럼 목록 (snake_case 키 기준). */
const TIMESTAMP_FIELDS = new Set([
  'approved_at',
  'last_login_at',
  'suspension_until',
  'created_at',
  'updated_at',
])

function rowToProfile(row: MemberProfileSelectRow): ProfileRow {
  return {
    id: row.id,
    display_name: row.displayName,
    email: row.email,
    phone_number: row.phoneNumber,
    birth_date: row.birthDate,
    real_name: row.realName,
    monthly_fee: row.monthlyFee,
    bank_name: row.bankName,
    account_number: row.accountNumber,
    account_holder: row.accountHolder,
    registration_status: row.registrationStatus,
    is_active: row.isActive,
    is_admin: row.isAdmin,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
    approved_at: toIso(row.approvedAt),
    approved_by: row.approvedBy,
    last_login_at: toIso(row.lastLoginAt),
    rejected_by: row.rejectedBy,
    suspension_reason: row.suspensionReason,
    suspension_until: toIso(row.suspensionUntil),
    is_suspended: row.isSuspended,
    profile_completeness_score: row.profileCompletenessScore,
    verification_status: row.verificationStatus,
    // DB에 CHECK가 없으므로 읽어 온 값이 목록 밖일 **수는** 있다. 읽기에서
    // 던지면 그 회원의 화면이 통째로 죽으므로 여기서는 캐스팅만 하고,
    // 목록 밖 값의 탐지는 `scripts/turso/check-invariants.mjs`가 맡는다.
    membership_type: row.membershipType as MembershipType,
    engagement_score: row.engagementScore,
    is_member: row.isMember,
    artist_id: row.artistId,
    is_artist: row.isArtist,
    artist_role: row.artistRole as ArtistRole,
    is_director: row.isDirector,
    director_title: row.directorTitle,
    is_auditor: row.isAuditor,
  }
}

/**
 * snake_case 쓰기 입력 → Drizzle `.values()`/`.set()`용 camelCase 객체.
 * 타임스탬프 컬럼은 ISO 문자열이면 `Date`로 바꾼다(Drizzle timestamp_ms
 * 컬럼은 `Date | null`을 기대한다). `null`은 그대로 `null`로 둔다.
 */
function toWriteRow(row: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (TIMESTAMP_FIELDS.has(key) && typeof value === 'string') {
      converted[key] = new Date(value)
    } else {
      converted[key] = value
    }
  }
  return toCamelCase(converted)
}

/**
 * id로 프로필 한 건을 조회한다.
 * @returns 행이 없으면 `null`. 조회 자체가 실패하면(연결 오류 등) throw한다.
 */
export async function getProfileById(id: string): Promise<ProfileRow | null> {
  const rows = await db.select().from(memberProfiles).where(eq(memberProfiles.id, id)).limit(1)
  return rows[0] ? rowToProfile(rows[0]) : null
}

/**
 * 권한 판정에 필요한 세 컬럼만 조회한다.
 *
 * `getProfileById`는 33개 컬럼 전부(계좌번호·실명·전화번호·생년월일 같은
 * 민감 컬럼 포함)를 실어 온다. "이 사람이 승인된 활성 관리자인가"만 알면
 * 되는 호출부가 그 함수를 쓰면, 필요 없는 개인정보를 요청마다 프로세스 안으로
 * 끌어들이고 그 객체가 응답에 실릴 여지를 만든다 — `src/lib/server/authz.ts`의
 * `toSessionProfileFields`가 같은 이유로 세션 컨텍스트를 좁혀 놓았다.
 *
 * 반환 모양은 `authz.ts`의 `ProfileLike` 부분집합이라
 * `isApprovedActiveAdmin()`에 그대로 넘길 수 있다.
 *
 * @returns 행이 없으면 `null`.
 */
export async function getProfileAuthzFields(id: string): Promise<{
  is_admin: boolean
  registration_status: RegistrationStatus
  is_active: boolean
} | null> {
  const rows = await db
    .select({
      isAdmin: memberProfiles.isAdmin,
      registrationStatus: memberProfiles.registrationStatus,
      isActive: memberProfiles.isActive,
    })
    .from(memberProfiles)
    .where(eq(memberProfiles.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    is_admin: row.isAdmin,
    registration_status: row.registrationStatus,
    is_active: row.isActive,
  }
}

/**
 * 표시 이름 한 칸만 읽는다. 알림 문구에 "누가 썼는지"를 넣으려고 전체 행을
 * 끌어오면 계좌번호·실명·전화번호·생년월일이 함께 딸려 온다(위
 * `getProfileAuthzFields`의 주석과 같은 이유).
 *
 * @returns 행이 없으면 `null`.
 */
export async function getProfileDisplayName(id: string): Promise<string | null> {
  const rows = await db
    .select({ displayName: memberProfiles.displayName })
    .from(memberProfiles)
    .where(eq(memberProfiles.id, id))
    .limit(1)
  return rows[0]?.displayName ?? null
}

/**
 * 여러 id의 프로필을 **쿼리 한 번**으로 조회한다. 게시글·댓글 목록에서
 * 저자 정보를 채울 때 N+1을 피하려고 쓴다.
 *
 * `ids`가 빈 배열이면 쿼리를 실행하지 않고 빈 Map을 즉시 돌려준다 —
 * Drizzle의 `inArray()`에 빈 배열을 넘기면 유효하지 않은 SQL이 생성된다.
 *
 * @returns id → ProfileRow의 Map. 존재하지 않는 id는 Map에 없다(에러 아님).
 */
export async function getProfilesByIds(ids: string[]): Promise<Map<string, ProfileRow>> {
  if (ids.length === 0) return new Map()
  const rows = await db.select().from(memberProfiles).where(inArray(memberProfiles.id, ids))
  return new Map(rows.map(row => [row.id, rowToProfile(row)]))
}

/**
 * 관리자 회원 목록 등 페이지네이션 목록 조회.
 * `status` 생략 시 전체, `search`는 display_name/email/real_name에 대한
 * 부분일치(OR)다. 정렬은 `created_at` 내림차순(최신 가입순)으로 고정 —
 * 기존 `/api/admin/members`가 쓰던 정렬과 같다.
 */
export async function listProfiles(
  filter: ListProfilesFilter
): Promise<{ rows: ProfileRow[]; total: number }> {
  const conditions: SQL[] = []
  if (filter.status) {
    conditions.push(eq(memberProfiles.registrationStatus, filter.status))
  }
  if (filter.search) {
    const needle = `%${filter.search}%`
    conditions.push(
      or(
        like(memberProfiles.displayName, needle),
        like(memberProfiles.email, needle),
        like(memberProfiles.realName, needle)
      ) as SQL
    )
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(memberProfiles)
      .where(where)
      .orderBy(desc(memberProfiles.createdAt))
      .limit(filter.limit)
      .offset(filter.offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(memberProfiles)
      .where(where),
  ])

  return {
    rows: rows.map(rowToProfile),
    total: Number(totalRows[0]?.count ?? 0),
  }
}

export interface AdminMemberCounts {
  totalMembers: number
  pendingMembers: number
  activeArtists: number
}

/**
 * `/api/admin/stats` 대시보드가 쓰는 회원 관련 count 3개(전체/승인대기/활성
 * 아티스트)를 한 번에 낸다(Task 8). count만 필요하므로 행 전송 없이 집계
 * 쿼리 3개를 병렬 실행한다 — 기존 Supabase `.select('id', {count:'exact',
 * head:true})` 3회와 동일 의미.
 */
export async function getAdminMemberCounts(): Promise<AdminMemberCounts> {
  const [totalRow, pendingRow, artistRow] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(memberProfiles),
    db
      .select({ value: sql<number>`count(*)` })
      .from(memberProfiles)
      .where(eq(memberProfiles.registrationStatus, 'pending')),
    db
      .select({ value: sql<number>`count(*)` })
      .from(memberProfiles)
      .where(and(eq(memberProfiles.isArtist, true), eq(memberProfiles.isActive, true))),
  ])
  return {
    totalMembers: Number(totalRow[0]?.value ?? 0),
    pendingMembers: Number(pendingRow[0]?.value ?? 0),
    activeArtists: Number(artistRow[0]?.value ?? 0),
  }
}

// -------------------------------------------------------------------------
// 관리자 리포트 (Task 8) — /api/admin/reports/generate
// -------------------------------------------------------------------------

export interface ProfileReportSummary {
  id: string
  display_name: string
  email: string
  registration_status: RegistrationStatus
  created_at: string
  is_active: boolean
}

/** `generateMemberActivityReport`의 "전체 회원 통계" 기본 데이터. 날짜
 * 범위와 무관하게 전체 회원을 담는다(원본 Supabase 쿼리도 날짜 필터가
 * 없었다). */
export async function listAllProfilesSummary(): Promise<ProfileReportSummary[]> {
  const rows = await db
    .select({
      id: memberProfiles.id,
      displayName: memberProfiles.displayName,
      email: memberProfiles.email,
      registrationStatus: memberProfiles.registrationStatus,
      createdAt: memberProfiles.createdAt,
      isActive: memberProfiles.isActive,
    })
    .from(memberProfiles)
    .orderBy(desc(memberProfiles.createdAt))
  return rows.map(row => ({
    id: row.id,
    display_name: row.displayName,
    email: row.email,
    registration_status: row.registrationStatus,
    created_at: toIso(row.createdAt) as string,
    is_active: row.isActive,
  }))
}

export interface ProfileRegistrationReportRow {
  id: string
  display_name: string
  email: string
  registration_status: RegistrationStatus
  is_artist: boolean
  created_at: string
}

/** `generateUserRegistrationReport`의 "기간 내 신규 등록자"(created_at 기준). */
export async function listProfilesCreatedInRange(
  start: Date,
  end: Date
): Promise<ProfileRegistrationReportRow[]> {
  const rows = await db
    .select({
      id: memberProfiles.id,
      displayName: memberProfiles.displayName,
      email: memberProfiles.email,
      registrationStatus: memberProfiles.registrationStatus,
      isArtist: memberProfiles.isArtist,
      createdAt: memberProfiles.createdAt,
    })
    .from(memberProfiles)
    .where(and(gte(memberProfiles.createdAt, start), lte(memberProfiles.createdAt, end)))
  return rows.map(row => ({
    id: row.id,
    display_name: row.displayName,
    email: row.email,
    registration_status: row.registrationStatus,
    is_artist: row.isArtist,
    created_at: toIso(row.createdAt) as string,
  }))
}

export interface ProfileStatusChangeReportRow extends ProfileRegistrationReportRow {
  updated_at: string
}

/** `generateUserRegistrationReport`의 "기간 내 상태가 변경된 회원"(updated_at
 * 기준). */
export async function listProfilesUpdatedInRange(
  start: Date,
  end: Date
): Promise<ProfileStatusChangeReportRow[]> {
  const rows = await db
    .select({
      id: memberProfiles.id,
      displayName: memberProfiles.displayName,
      email: memberProfiles.email,
      registrationStatus: memberProfiles.registrationStatus,
      isArtist: memberProfiles.isArtist,
      createdAt: memberProfiles.createdAt,
      updatedAt: memberProfiles.updatedAt,
    })
    .from(memberProfiles)
    .where(and(gte(memberProfiles.updatedAt, start), lte(memberProfiles.updatedAt, end)))
  return rows.map(row => ({
    id: row.id,
    display_name: row.displayName,
    email: row.email,
    registration_status: row.registrationStatus,
    is_artist: row.isArtist,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
  }))
}

export interface RejectedProfileReportRow {
  id: string
  display_name: string
  email: string
  created_at: string
  updated_at: string
}

/** `generateUserRegistrationReport`의 "최근 거부된 회원들"
 * (registration_status='rejected' AND updated_at 기간 내), updated_at desc. */
export async function listRejectedProfilesInRange(
  start: Date,
  end: Date
): Promise<RejectedProfileReportRow[]> {
  const rows = await db
    .select({
      id: memberProfiles.id,
      displayName: memberProfiles.displayName,
      email: memberProfiles.email,
      createdAt: memberProfiles.createdAt,
      updatedAt: memberProfiles.updatedAt,
    })
    .from(memberProfiles)
    .where(
      and(
        eq(memberProfiles.registrationStatus, 'rejected'),
        gte(memberProfiles.updatedAt, start),
        lte(memberProfiles.updatedAt, end)
      )
    )
    .orderBy(desc(memberProfiles.updatedAt))
  return rows.map(row => ({
    id: row.id,
    display_name: row.displayName,
    email: row.email,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
  }))
}

/**
 * `getDailyRegistrationBreakdown`이 일별로 그룹화할 원재료(created_at +
 * registration_status만). 정렬 없음 — 호출부가 JS에서 날짜별로 묶는다(원본
 * Supabase 쿼리도 정렬이 없었다).
 */
export async function listProfileRegistrationStatusInRange(
  start: Date,
  end: Date
): Promise<{ created_at: string; registration_status: RegistrationStatus }[]> {
  const rows = await db
    .select({
      createdAt: memberProfiles.createdAt,
      registrationStatus: memberProfiles.registrationStatus,
    })
    .from(memberProfiles)
    .where(and(gte(memberProfiles.createdAt, start), lte(memberProfiles.createdAt, end)))
  return rows.map(row => ({
    created_at: toIso(row.createdAt) as string,
    registration_status: row.registrationStatus,
  }))
}

/**
 * `/api/admin/stats/monthly`의 월별 회원 가입 집계에 쓰는 가벼운 조회
 * (Task 8) — `created_at`/`registration_status`만 담아 반환한다(월별로 JS에서
 * 버케팅하므로 전체 프로필 컬럼이 필요 없다). 기존 Supabase
 * `.gte('created_at', startDate).order('created_at', {ascending:true})`와
 * 동일 조건. `limit` 없음 — 집계 대상 기간(최대 24개월) 전체가 필요하다.
 */
export async function listProfileSignupsSince(
  since: Date
): Promise<{ created_at: string; registration_status: RegistrationStatus }[]> {
  const rows = await db
    .select({
      createdAt: memberProfiles.createdAt,
      registrationStatus: memberProfiles.registrationStatus,
    })
    .from(memberProfiles)
    .where(gte(memberProfiles.createdAt, since))
    .orderBy(asc(memberProfiles.createdAt))
  return rows.map(row => ({
    created_at: toIso(row.createdAt) as string,
    registration_status: row.registrationStatus,
  }))
}

/**
 * `/api/admin/activity`의 "최근 회원 가입 활동"에 쓰는 조회(Task 8). 기존
 * Supabase `.gte('created_at', cutoffDate).order('created_at',
 * {ascending:false}).limit(n)`과 동일 조건.
 */
export async function listRecentProfilesForActivity(
  since: Date,
  limit: number
): Promise<ProfileRow[]> {
  const rows = await db
    .select()
    .from(memberProfiles)
    .where(gte(memberProfiles.createdAt, since))
    .orderBy(desc(memberProfiles.createdAt))
    .limit(limit)
  return rows.map(rowToProfile)
}

/**
 * 충돌(같은 id로 다시 upsertProfile을 호출) 시 새 값으로 갱신을 **허용하는**
 * 컬럼의 화이트리스트(camelCase, Drizzle 필드명 기준). 여기 없는 컬럼은
 * SET 절에 아예 들어가지 않아 원래 값 그대로 남는다.
 *
 * 이 함수가 대체한 원본 Postgres 트리거
 * (`supabase/migrations/20250108090010_fix_signup_flow.sql:53-65`)가
 * `ON CONFLICT ... DO UPDATE SET`에 실제로 열거한 컬럼과 정확히 같다 —
 * `email`·`display_name`·`real_name`·`phone_number`·`birth_date`·
 * `monthly_fee`·`bank_name`·`account_number`·`account_holder`(트리거는
 * `email`만 무조건 덮어쓰고 나머지는 `COALESCE`를 썼다; 이 함수는 아래
 * `buildConflictSet`에서 전부 `COALESCE`로 통일한다 — 의미 차이는 없다,
 * `email`은 두 upsertProfile 호출부 모두 매번 같은 값을 넘긴다).
 *
 * **왜 블랙리스트가 아니라 화이트리스트인가.** 이전 구현은
 * "`registration_status`·`is_active`·`is_admin`·`is_director`·`is_auditor`만
 * 빼고 전부 갱신"이었다(블랙리스트). 코드리뷰(9pre-2 Important 2)가 그
 * 구멍을 실측으로 지적했다 — `is_member`는 `buildMemberProfileRow`
 * (`profileHook.ts:39`)와 `buildSignupProfileRow`(`signupProfile.ts:107`)
 * 둘 다 항상 `true`를 명시적으로 쓰므로 블랙리스트에 없으면 매번 `true`로
 * 덮인다. 오늘은 `is_member=false`를 쓰는 코드가 없어 무해하지만, 앞으로
 * `src/lib/auth/`의 빌더에 컬럼이 추가될 때마다 `src/db/queries/`의 보호
 * 목록도 같이 고쳐야 하는데 두 파일이 갱신될 이유가 서로 달라 드리프트를
 * 아무도 못 잡는다 — 블랙리스트의 기본값은 "새 컬럼은 갱신된다"라 위험한
 * 쪽으로 열려 있다.
 *
 * 화이트리스트는 기본값이 반대다 — 새 컬럼이 추가돼도 여기 넣지 않는 한
 * 충돌 시 갱신되지 않는다. 최악의 실패 모드가 "갱신 누락"(데이터가 낡은
 * 채로 남음, 다음 배포에서 화이트리스트를 넓히면 바로 고쳐짐)으로 바뀐다
 * — "권한·승인 상태 유출"(Turso에 PITR이 없어 복구 불가)보다 훨씬 싼
 * 실패다. 이 표의 위험 비대칭성 때문에 기본값을 안전한 쪽으로 뒤집었다.
 *
 * 지금 있는 호출부(가입 훅, `/api/member-signup`)는 항상 새 id로만 호출해
 * 이 분기에 닿지 않는다. 하지만 재이관·재가입·관리자 복구 헬퍼가 생기는
 * 순간 살아난다.
 */
const CONFLICT_UPDATABLE_FIELDS: ReadonlySet<string> = new Set([
  'email',
  'displayName',
  'realName',
  'phoneNumber',
  'birthDate',
  'monthlyFee',
  'bankName',
  'accountNumber',
  'accountHolder',
])

/**
 * `values`로부터 onConflictDoUpdate용 `set` 객체를 만든다.
 *
 * - `CONFLICT_UPDATABLE_FIELDS`에 있는 컬럼만 SET 절에 넣는다. 그 밖의
 *   모든 키(`id`, 권한·승인 상태 컬럼, `is_member`, 그리고 앞으로 추가될
 *   무엇이든)는 화이트리스트 밖이라 자동으로 제외된다 — SET 절에 없는
 *   컬럼은 충돌 시 원래 값 그대로 남는다.
 * - 화이트리스트 안 컬럼은 `COALESCE(excluded.col, member_profiles.col)`로
 *   감싼다. `buildSignupProfileRow`/`buildMemberProfileRow`는 미입력
 *   필드에 `undefined`가 아니라 명시적 `null`을 쓰므로, Drizzle 기본
 *   동작(`set: values`)처럼 그 값을 그대로 썼다가는 재이관 등에서 기존
 *   값(전화번호·계좌번호 등)이 null로 덮인다. COALESCE는 새 값이 null일
 *   때만 기존 값을 지키고, 실제로 값이 오면(예: 정정) 그 값으로 갱신한다
 *   — 원본 트리거의 `COALESCE(EXCLUDED.x, member_profiles.x)`와 같은
 *   의미다.
 */
function buildConflictSet(values: Record<string, unknown>): Record<string, SQL> {
  const columns = memberProfiles as unknown as Record<string, AnySQLiteColumn>
  const set: Record<string, SQL> = {}
  for (const key of Object.keys(values)) {
    if (!CONFLICT_UPDATABLE_FIELDS.has(key)) continue
    const column = columns[key]
    if (!column) continue
    set[key] = sql`coalesce(excluded.${sql.identifier(column.name)}, ${column})`
  }
  return set
}

/** `db.transaction(async tx => ...)`이 넘겨주는 트랜잭션 핸들의 타입. */
type ProfileTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * `where`에 걸린 행들의 `profile_completeness_score`를 현재 값 기준으로 다시
 * 매긴다. Postgres 트리거 `profile_completeness_trigger`의 대체다 — 배점
 * 근거와 원본과의 차이는 `./profileCompleteness.ts`에 적어 뒀다.
 *
 * **반드시 본 쓰기와 같은 트랜잭션 안에서, 본 쓰기 다음에 별도 문장으로
 * 호출한다.** 같은 `UPDATE`의 SET 절에 섞으면 SQLite가 갱신 전 값으로 식을
 * 평가해 점수가 한 박자 늦는다(원본 트리거가 가졌던 바로 그 결함).
 *
 * `updated_at`을 자기 자신으로 못박는 이유: 이 문장은 방금 커밋될 변경에서
 * **파생된** 값을 채우는 것이지 새로운 변경이 아니다. 스키마의 `$onUpdate`
 * 훅은 `set`에 키가 없을 때만 현재 시각을 채우므로(drizzle-orm/sqlite-core/
 * dialect.cjs의 `set[colName] ?? onUpdateFnResult`), 여기서 명시적으로 넘겨야
 * 본 쓰기가 찍은 `updated_at`이 밀리지 않는다.
 */
async function recomputeCompleteness(tx: ProfileTx, where: SQL): Promise<void> {
  await tx
    .update(memberProfiles)
    .set({
      profileCompletenessScore: profileCompletenessExpression(),
      updatedAt: sql`${sql.identifier(memberProfiles.updatedAt.name)}`,
    })
    .where(where)
}

/**
 * 프로필을 생성하거나(id 미존재) 갱신한다(id 존재).
 * 가입 훅·member-signup 라우트가 쓴다. `id`/`email`/`display_name`은 필수,
 * 나머지 컬럼은 DB 기본값(pending/비활성 등)에 맡길 수 있다.
 *
 * id가 충돌하면(재이관·재가입·관리자 복구 등) `CONFLICT_UPDATABLE_FIELDS`
 * 화이트리스트 안 컬럼(연락처·계좌 정보 등 "데이터" 컬럼)만 새 값이 null이
 * 아닐 때 갱신하고, 그 밖의 모든 컬럼(권한·승인 상태 포함)은 화이트리스트
 * 밖이라 갱신하지 않는다(`buildConflictSet` 참조) — 신규 생성(id 미존재)
 * 경로는 이 분기와 무관하게 항상 `values`를 그대로 insert한다.
 *
 * @throws DB 쓰기가 실패하면 그대로 던진다(삼키지 않는다) — 호출부가
 * 실패를 어떻게 다룰지(예: member-signup의 202 분기) 결정한다.
 */
export async function upsertProfile(row: UpsertProfileInput): Promise<void> {
  const values = toWriteRow(row) as typeof memberProfiles.$inferInsert
  await db.transaction(async tx => {
    await tx
      .insert(memberProfiles)
      .values(values)
      .onConflictDoUpdate({ target: memberProfiles.id, set: buildConflictSet(values) })
    await recomputeCompleteness(tx, eq(memberProfiles.id, values.id))
  })
}

/**
 * 프로필 일부 컬럼을 갱신한다. `id`는 patch에 넣지 않는다(별도 인자).
 * `updated_at`은 patch에 넘겨도 무시한다 — 스키마의 `$onUpdate` 훅
 * (`src/db/schema/_shared.ts`의 `updatedAt()`)이 `.set()` 호출마다 자동으로
 * 현재 시각을 채운다(Postgres 트리거가 없으므로 이게 그 대체다).
 * patch가 빈 객체면 쿼리를 실행하지 않는다(갱신할 것이 없다).
 */
export async function updateProfile(id: string, patch: ProfilePatch): Promise<void> {
  const { updated_at: _ignoredUpdatedAt, ...rest } = patch as Record<string, unknown>
  const values = toWriteRow(rest)
  if (Object.keys(values).length === 0) return
  await db.transaction(async tx => {
    await tx
      .update(memberProfiles)
      .set(values as Partial<typeof memberProfiles.$inferInsert>)
      .where(eq(memberProfiles.id, id))
    await recomputeCompleteness(tx, eq(memberProfiles.id, id))
  })
}

/**
 * 여러 id에 같은 patch를 한 번에 적용한다 — 관리자 대량 승인/거부/정지처럼
 * "여러 회원에게 똑같은 변경을 가한다"는 작업 전용이다. `inArray` + **단일
 * UPDATE**로 끝낸다. id마다 `updateProfile`을 순차 호출하면
 * `src/app/api/admin/members/bulk/route.ts`가 전수감사(API High 5)에서 이미
 * 한 번 고친 N+1(멤버당 select+update 순차 실행)이 되살아난다 — 이 함수는
 * 그 회귀를 막으려고 존재한다.
 *
 * `ids`가 빈 배열이면 쿼리를 실행하지 않고 즉시 빈 배열을 돌려준다 —
 * `getProfilesByIds`와 같은 이유(Drizzle의 `inArray`는 빈 배열에서 무효
 * SQL을 만든다). patch가 빈 객체(`updated_at`만 있어도 무시되므로 사실상
 * 빈 객체)면 마찬가지로 쿼리 없이 빈 배열을 돌려준다.
 *
 * `updated_at`은 patch에 넘겨도 무시한다 — `updateProfile`과 동일하게
 * 스키마의 `$onUpdate` 훅이 `.set()` 호출마다 자동으로 채운다.
 *
 * @returns 실제로 갱신된 행의 id 목록(`RETURNING id`). `ids`에 포함됐지만
 * 존재하지 않는 id는 결과에서 빠진다 — 호출부가 "몇 명이 실제로 바뀌었는지"
 * 응답에 담을 때 이 배열의 길이/내용을 쓰면 된다.
 */
export async function updateProfilesByIds(ids: string[], patch: ProfilePatch): Promise<string[]> {
  if (ids.length === 0) return []
  const { updated_at: _ignoredUpdatedAt, ...rest } = patch as Record<string, unknown>
  const values = toWriteRow(rest)
  if (Object.keys(values).length === 0) return []
  return db.transaction(async tx => {
    const rows = await tx
      .update(memberProfiles)
      .set(values as Partial<typeof memberProfiles.$inferInsert>)
      .where(inArray(memberProfiles.id, ids))
      .returning({ id: memberProfiles.id })
    // 실제로 갱신된 행만 다시 매긴다 — 존재하지 않는 id까지 WHERE에 넣어도
    // 결과는 같지만, "이번 UPDATE가 건드린 행"과 점수 재계산 대상을 같은
    // 집합으로 묶어 두는 편이 읽기 쉽다.
    const updatedIds = rows.map(row => row.id)
    if (updatedIds.length > 0) {
      await recomputeCompleteness(tx, inArray(memberProfiles.id, updatedIds))
    }
    return updatedIds
  })
}

// -------------------------------------------------------------------------
// 프로필 없는 계정("유령 회원") — 단계 4 Task 6b
// -------------------------------------------------------------------------

/**
 * Better Auth `user` 행은 있는데 `member_profiles` 행이 없는 계정.
 *
 * 이런 계정은 로그인은 되지만 `/register/pending`에 영구 체류하고, 관리자
 * 회원 목록(`listProfiles`는 `member_profiles`만 읽는다)에도 뜨지 않으며,
 * `user.email` UNIQUE 때문에 같은 이메일로 재가입도 막힌다. 어떻게 생기는지는
 * `src/lib/auth/server.ts`의 가입 훅 주석 참고.
 */
export interface ProfilelessUser {
  id: string
  email: string
  /** Better Auth `user.name` — 가입 폼의 표시명이 들어 있다. */
  name: string
  created_at: string
}

/**
 * 프로필이 없는 계정 목록(가입 최신순). 관리자 화면이 "유령 회원"을 발견하는
 * 유일한 경로다 — 이 조회가 없으면 그런 계정은 어떤 화면에도 나타나지 않는다.
 *
 * `limit`은 호출부가 정한다. 정상 상태에서는 0행이므로 상한은 사고가 났을 때
 * 화면과 응답이 터지지 않게 하는 안전장치일 뿐이다.
 */
export async function listProfilelessUsers(limit: number): Promise<ProfilelessUser[]> {
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    })
    .from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.id, user.id))
    .where(sql`${memberProfiles.id} is null`)
    .orderBy(desc(user.createdAt))
    .limit(limit)
  return rows.map(row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: toIso(row.createdAt) as string,
  }))
}

/**
 * 프로필이 없는 계정 한 건을 id로 조회한다. 관리자 복구 라우트가 "정말로
 * 프로필이 없는 계정인지" 확인한 뒤 그 계정의 email/name으로 프로필을 만들 때
 * 쓴다 — 이미 프로필이 있는 회원에게 복구를 걸어 기존 행을 건드리는 일을
 * 조회 단계에서 막는다.
 *
 * @returns 계정이 없거나 이미 프로필이 있으면 `null`.
 */
export async function getProfilelessUserById(id: string): Promise<ProfilelessUser | null> {
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    })
    .from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.id, user.id))
    .where(and(eq(user.id, id), sql`${memberProfiles.id} is null`))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: toIso(row.createdAt) as string,
  }
}
