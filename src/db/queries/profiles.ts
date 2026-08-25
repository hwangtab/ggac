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

import { and, asc, desc, eq, gte, inArray, like, or, sql, type SQL } from 'drizzle-orm'

import { db } from '../client.ts'
import { memberProfiles } from '../schema/index.ts'

import { toCamelCase, toIso } from './_helpers.ts'

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
  membership_type: string
  engagement_score: number
  is_member: boolean
  artist_id: string | null
  is_artist: boolean
  artist_role: string
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
    membership_type: row.membershipType,
    engagement_score: row.engagementScore,
    is_member: row.isMember,
    artist_id: row.artistId,
    is_artist: row.isArtist,
    artist_role: row.artistRole,
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
 * 프로필을 생성하거나(id 미존재) 갱신한다(id 존재).
 * 가입 훅·member-signup 라우트가 쓴다. `id`/`email`/`display_name`은 필수,
 * 나머지 컬럼은 DB 기본값(pending/비활성 등)에 맡길 수 있다.
 * @throws DB 쓰기가 실패하면 그대로 던진다(삼키지 않는다) — 호출부가
 * 실패를 어떻게 다룰지(예: member-signup의 202 분기) 결정한다.
 */
export async function upsertProfile(row: UpsertProfileInput): Promise<void> {
  const values = toWriteRow(row) as typeof memberProfiles.$inferInsert
  await db
    .insert(memberProfiles)
    .values(values)
    .onConflictDoUpdate({ target: memberProfiles.id, set: values })
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
  await db
    .update(memberProfiles)
    .set(values as Partial<typeof memberProfiles.$inferInsert>)
    .where(eq(memberProfiles.id, id))
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
  const rows = await db
    .update(memberProfiles)
    .set(values as Partial<typeof memberProfiles.$inferInsert>)
    .where(inArray(memberProfiles.id, ids))
    .returning({ id: memberProfiles.id })
  return rows.map(row => row.id)
}
