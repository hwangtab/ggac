/**
 * `link_previews` · `event_applications` · `member_bulk_operations` 쿼리
 * 계층(Turso/Drizzle) + `execute_advanced_search` RPC 대체. 단계 4 Task 4 —
 * 서로 관련 없는 관심사를 묶은 "기타" 모듈이다(각자 개별 파일을 만들 만큼
 * 크지 않고, `execute_advanced_search`는 브리프가 이 작업의 "마지막 남은
 * RPC 2종" 중 하나로 명시했을 뿐 전용 파일이 배정되지 않았다).
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정은 호출부
 * (`src/utils/linkPreviewCache.ts`의 소비처 `requireUser()`,
 * `src/app/api/admin/event-applications/*`·`src/app/api/admin/members/bulk/
 * route.ts`·`src/app/api/admin/members/advanced-search/route.ts`의
 * `auth: 'admin'`)의 몫이다.
 *
 * 응답 형태는 snake_case다(CLAUDE.md).
 */

import { and, count, desc, eq, type SQL } from 'drizzle-orm'

import { db, rawClient } from '../client.ts'
import { eventApplications, linkPreviews, memberBulkOperations } from '../schema/index.ts'

import { toIso } from './_helpers.ts'

// -------------------------------------------------------------------------
// link_previews — src/utils/linkPreviewCache.ts 대체
// -------------------------------------------------------------------------

/**
 * 캐시 조회. `getCachedPreviewFromDB`(Supabase `.select('data,last_fetched,
 * ttl_seconds').eq('url', url).single()`) 대체. TTL 만료 판정은 호출부가
 * 아니라 이 함수가 그대로 한다 — 원본과 동일하게 만료된 캐시는 `null`을
 * 반환한다(만료 행을 지우지는 않는다, 원본도 지우지 않았다).
 */
export async function getCachedLinkPreview(url: string): Promise<unknown | null> {
  const [row] = await db
    .select({
      data: linkPreviews.data,
      lastFetched: linkPreviews.lastFetched,
      ttlSeconds: linkPreviews.ttlSeconds,
    })
    .from(linkPreviews)
    .where(eq(linkPreviews.url, url))
    .limit(1)
  if (!row) return null

  const lastFetchedMs = row.lastFetched.getTime()
  const ttlMs = (row.ttlSeconds ?? 21600) * 1000
  if (Date.now() - lastFetchedMs <= ttlMs) {
    return row.data
  }
  return null
}

/**
 * 캐시 upsert. `setCachedPreviewToDB`(Supabase `.upsert({...}, {onConflict:
 * 'url'})`) 대체.
 */
export async function setCachedLinkPreview(
  url: string,
  preview: unknown,
  ttlSeconds = 21600
): Promise<void> {
  await db
    .insert(linkPreviews)
    .values({
      url,
      data: preview as Record<string, unknown>,
      lastFetched: new Date(),
      ttlSeconds,
    })
    .onConflictDoUpdate({
      target: linkPreviews.url,
      set: {
        data: preview as Record<string, unknown>,
        lastFetched: new Date(),
        ttlSeconds,
      },
    })
}

// -------------------------------------------------------------------------
// event_applications
// -------------------------------------------------------------------------

export interface EventApplicationRow {
  id: string
  event_slug: string
  applicant_name: string
  contact_email: string | null
  contact_phone: string | null
  performance_info: string | null
  items_to_sell: string | null
  links: string | null
  message: string | null
  status: string
  created_at: string
  updated_at: string
  privacy_consent: boolean
  privacy_consent_at: string | null
  participation_type: string | null
  photo_url: string | null
}

function rowToEventApplication(row: typeof eventApplications.$inferSelect): EventApplicationRow {
  return {
    id: row.id,
    event_slug: row.eventSlug,
    applicant_name: row.applicantName,
    contact_email: row.contactEmail,
    contact_phone: row.contactPhone,
    performance_info: row.performanceInfo,
    items_to_sell: row.itemsToSell,
    links: row.links,
    message: row.message,
    status: row.status,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
    privacy_consent: row.privacyConsent,
    privacy_consent_at: toIso(row.privacyConsentAt),
    participation_type: row.participationType,
    photo_url: row.photoUrl,
  }
}

export interface CreateEventApplicationInput {
  event_slug: string
  applicant_name: string
  contact_email: string | null
  contact_phone: string
  performance_info: string | null
  items_to_sell: string | null
  links: string | null
  message: string | null
  participation_type: string | null
  photo_url: string | null
  privacy_consent: boolean
  privacy_consent_at: string
}

/**
 * 공개 신청 폼 제출. `src/app/api/event-applications/route.ts` POST의
 * `.insert(cleanedData).select('id').single()` 대체.
 */
export async function createEventApplication(
  input: CreateEventApplicationInput
): Promise<{ id: string }> {
  const [row] = await db
    .insert(eventApplications)
    .values({
      eventSlug: input.event_slug,
      applicantName: input.applicant_name,
      contactEmail: input.contact_email,
      contactPhone: input.contact_phone,
      performanceInfo: input.performance_info,
      itemsToSell: input.items_to_sell,
      links: input.links,
      message: input.message,
      participationType: input.participation_type,
      photoUrl: input.photo_url,
      privacyConsent: input.privacy_consent,
      privacyConsentAt: new Date(input.privacy_consent_at),
    })
    .returning({ id: eventApplications.id })
  return row
}

export interface ListEventApplicationsFilter {
  eventSlug?: string | null
  status?: string | null
  /** 1부터. */
  page: number
  limit: number
}

/**
 * `src/app/api/admin/event-applications/route.ts` GET의 페이지네이션 목록.
 * `created_at` 내림차순은 원본과 동일.
 */
export async function listEventApplications(
  filter: ListEventApplicationsFilter
): Promise<{ rows: EventApplicationRow[]; total: number }> {
  const conditions: SQL[] = []
  if (filter.eventSlug) conditions.push(eq(eventApplications.eventSlug, filter.eventSlug))
  if (filter.status) conditions.push(eq(eventApplications.status, filter.status))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const offset = Math.max(0, (filter.page - 1) * filter.limit)

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(eventApplications)
      .where(where)
      .orderBy(desc(eventApplications.createdAt))
      .limit(filter.limit)
      .offset(offset),
    db.select({ value: count() }).from(eventApplications).where(where),
  ])

  return { rows: rows.map(rowToEventApplication), total: totalRows[0]?.value ?? 0 }
}

/** 상태만 갱신. `admin/event-applications` PATCH 대체. */
export async function updateEventApplicationStatus(id: string, status: string): Promise<void> {
  await db
    .update(eventApplications)
    .set({ status, updatedAt: new Date() })
    .where(eq(eventApplications.id, id))
}

export interface EventApplicationFieldPatch {
  applicant_name: string
  contact_email: string | null
  contact_phone: string | null
  performance_info: string | null
  items_to_sell: string | null
  links: string | null
  message: string | null
  participation_type: string | null
}

/** 신청 필드 일괄 수정. `admin/event-applications` PUT 대체. */
export async function updateEventApplicationFields(
  id: string,
  patch: EventApplicationFieldPatch
): Promise<void> {
  await db
    .update(eventApplications)
    .set({
      applicantName: patch.applicant_name,
      contactEmail: patch.contact_email,
      contactPhone: patch.contact_phone,
      performanceInfo: patch.performance_info,
      itemsToSell: patch.items_to_sell,
      links: patch.links,
      message: patch.message,
      participationType: patch.participation_type,
      updatedAt: new Date(),
    })
    .where(eq(eventApplications.id, id))
}

/** `admin/event-applications` DELETE 대체. */
export async function deleteEventApplication(id: string): Promise<void> {
  await db.delete(eventApplications).where(eq(eventApplications.id, id))
}

// -------------------------------------------------------------------------
// member_bulk_operations — 대량 작업 감사 로그
// -------------------------------------------------------------------------

export interface BulkOperationRow {
  id: string
  operation_type: string
  performed_by: string
  member_ids: string[]
  parameters: Record<string, unknown>
  results: Record<string, unknown>
  status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

function rowToBulkOperation(row: typeof memberBulkOperations.$inferSelect): BulkOperationRow {
  return {
    id: row.id,
    operation_type: row.operationType,
    performed_by: row.performedBy,
    member_ids: row.memberIds,
    parameters: row.parameters,
    results: row.results,
    status: row.status,
    created_at: toIso(row.createdAt) as string,
    started_at: toIso(row.startedAt),
    completed_at: toIso(row.completedAt),
    error_message: row.errorMessage,
  }
}

export interface CreateBulkOperationInput {
  operation_type: string
  performed_by: string
  member_ids: string[]
  parameters: Record<string, unknown>
}

/**
 * 대량 작업 로그 생성. `src/app/api/admin/members/bulk/route.ts` POST의
 * `.insert({...}).select().single()` 대체 — `status: 'pending'`으로 시작하는
 * 것도 동일하다.
 */
export async function createBulkOperation(
  input: CreateBulkOperationInput
): Promise<BulkOperationRow> {
  const [row] = await db
    .insert(memberBulkOperations)
    .values({
      operationType: input.operation_type,
      performedBy: input.performed_by,
      memberIds: input.member_ids,
      parameters: input.parameters,
      status: 'pending',
    })
    .returning()
  return rowToBulkOperation(row)
}

/** 작업 시작 표시. `bulk/route.ts`의 `status: 'in_progress'` 갱신 대체. */
export async function markBulkOperationInProgress(id: string): Promise<void> {
  await db
    .update(memberBulkOperations)
    .set({ status: 'in_progress', startedAt: new Date() })
    .where(eq(memberBulkOperations.id, id))
}

export interface BulkOperationResultsPatch {
  success_count: number
  error_count: number
  details: unknown[]
}

/** 작업 완료 표시. `bulk/route.ts`의 `status: 'completed'` 갱신 대체. */
export async function completeBulkOperation(
  id: string,
  results: BulkOperationResultsPatch
): Promise<void> {
  await db
    .update(memberBulkOperations)
    .set({
      status: 'completed',
      completedAt: new Date(),
      results: {
        success_count: results.success_count,
        error_count: results.error_count,
        details: results.details,
      },
    })
    .where(eq(memberBulkOperations.id, id))
}

/** 작업 실패 표시. `bulk/route.ts`의 `status: 'failed'` 갱신 대체. */
export async function failBulkOperation(
  id: string,
  results: BulkOperationResultsPatch,
  errorMessage: string
): Promise<void> {
  await db
    .update(memberBulkOperations)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorMessage,
      results: {
        success_count: results.success_count,
        error_count: results.error_count,
        details: results.details,
      },
    })
    .where(eq(memberBulkOperations.id, id))
}

/**
 * 최근 대량 작업 이력. `bulk/route.ts` GET의 `.select(...).order('created_at',
 * {ascending:false}).limit(50)` 대체. `performed_by_member` 조인은 원래도
 * 라우트가 별도로 붙였다(프로필 권위가 Turso로 옮겨진 뒤 배치 조회로
 * 바뀐 부분, 이 함수는 관여하지 않는다) — 그대로 유지한다.
 */
export async function listBulkOperations(limit = 50): Promise<BulkOperationRow[]> {
  const rows = await db
    .select()
    .from(memberBulkOperations)
    .orderBy(desc(memberBulkOperations.createdAt))
    .limit(limit)
  return rows.map(rowToBulkOperation)
}

// -------------------------------------------------------------------------
// execute_advanced_search RPC 대체 — src/app/api/admin/members/advanced-search/
// route.ts 전용
// -------------------------------------------------------------------------

/**
 * `execute_advanced_search` RPC 대체. 원본 RPC는 `EXECUTE prepared_query`로
 * 호출부(`advanced-search/route.ts`)가 `@/utils/advancedFiltering`의
 * `buildSearchQuery`로 조립한 Postgres 방언 SQL(`$1, $2, ...` 위치 인자 +
 * `ILIKE`)을 그대로 실행했다. **`buildSearchQuery`/`isValidFieldName`은
 * 손대지 않는다** — 필터·정렬 필드는 이미 그쪽에서 화이트리스트
 * (`allowedFields`)와 정규식(`^[a-zA-Z_][a-zA-Z0-9_.]*$`)으로 검증된
 * 뒤에만 SQL 문자열에 섞인다. 이 함수는 그 결과물을 SQLite 방언으로
 * 옮겨 실행만 한다:
 *
 * 1. `$N` → `?N`(SQLite 위치 인자 — libsql이 `?NNN` 형식을 지원한다).
 * 2. `ILIKE`/`NOT ILIKE` → `LIKE`/`NOT LIKE`(SQLite의 `LIKE`는 ASCII
 *    한정으로 기본 대소문자 무시라 근사치지만, 검색 대상 필드가 이메일·
 *    영문 표시명 위주라 실사용에는 차이가 없다).
 * 3. 값 바인딩은 **파라미터 그대로**(문자열 리터럴로 다시 조립하지
 *    않는다) — 원본 RPC의 `quote_literal(param)` 방식보다 이 방식이 더
 *    안전하다(quote_literal도 이스케이프 자체는 안전하지만, 최종적으로
 *    "문자열을 SQL에 섞어 넣는다"는 구조 자체가 남는다).
 * 4. `type:'date'` 필드는 `convertValue`가 ISO 문자열을 넣는데, Turso
 *    스키마의 `created_at`/`updated_at`/`last_login_at`/`suspension_until`은
 *    epoch ms 정수다(Postgres timestamptz와 다른 저장 방식). ISO 문자열을
 *    그대로 바인딩하면 SQLite가 INTEGER 컬럼과 TEXT 리터럴을 비교하며
 *    조용히 매치 0건이 된다 — `coerceParamForSqlite`가 ISO 8601 형태를
 *    감지해 epoch ms로 바꾼다.
 *
 * 기본 테이블 SQL(`baseTable` — 라우트가 넘긴다)은 라우트 자신이 만든
 * 신뢰된 리터럴이다(사용자 입력이 아니다). 원본은 `artists`를 직접
 * `LEFT JOIN`했지만, `artists`에도 `created_at`/`updated_at` 컬럼이 있어
 * `member_profiles`와 겹치는 별칭 없는 컬럼명이 정렬/필터에 쓰이면
 * "ambiguous column name"이 될 수 있다 — 이 함수를 호출하는
 * 라우트에서는 `artists`를 `(SELECT legacy_id, name, slug FROM
 * artists)` 서브쿼리로 좁혀 이 모호성을 원천 차단한다(결과 컬럼은
 * 원본과 동일하다, `a.name`/`a.slug`만 쓰였으므로).
 *
 * SQL 인젝션 방어는 다층이다: (a) 필드명 화이트리스트는
 * `buildSearchQuery`, (b) 값은 전부 파라미터 바인딩, (c) 이 함수가
 * 마지막 방어선으로 번역된 SQL에 `;`·`--`·`/*` 같은 다중 구문/주석
 * 시퀀스가 있으면 실행 전에 던진다(원본 `safe_execute_query`의 위험
 * 키워드 차단과 같은 취지의 트립와이어 — 정상적으로 조립된 SQL에는
 * 이 시퀀스들이 등장할 이유가 없다).
 */
function translateSearchSqlForSqlite(sql: string): string {
  const translated = sql.replace(/\$(\d+)/g, '?$1').replace(/ILIKE/g, 'LIKE')
  if (/;|--|\/\*/.test(translated)) {
    throw new Error('advanced search SQL에 허용되지 않는 시퀀스가 포함되어 있습니다.')
  }
  return translated
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function coerceParamForSqlite(value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATETIME_RE.test(value)) {
    return new Date(value).getTime()
  }
  return value
}

/** RPC가 JSONB로 돌려주던 boolean/timestamp 컬럼을 원래 타입으로 되돌린다. */
const ADVANCED_SEARCH_BOOLEAN_COLUMNS = new Set(['is_artist', 'is_admin', 'is_active'])
const ADVANCED_SEARCH_DATE_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'last_login_at',
  'suspension_until',
])

function normalizeAdvancedSearchRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (ADVANCED_SEARCH_BOOLEAN_COLUMNS.has(key)) {
      out[key] = value === null ? null : Boolean(value)
    } else if (ADVANCED_SEARCH_DATE_COLUMNS.has(key)) {
      out[key] =
        value === null || value === undefined ? null : new Date(Number(value)).toISOString()
    } else {
      out[key] = value
    }
  }
  return out
}

export interface AdvancedSearchResult {
  rows: Record<string, unknown>[]
  total: number
}

/**
 * `dataSql`/`countSql`/`params`는 호출부가 `buildSearchQuery`로 이미
 * 조립한 것을 그대로 넘긴다. 이 함수는 방언 번역·타입 보정·실행만 한다.
 */
export async function executeMemberAdvancedSearch(
  dataSql: string,
  countSql: string,
  params: unknown[]
): Promise<AdvancedSearchResult> {
  const args = params.map(coerceParamForSqlite) as (string | number | boolean | Date | null)[]

  const [dataResult, countResult] = await Promise.all([
    rawClient.execute({ sql: translateSearchSqlForSqlite(dataSql), args }),
    rawClient.execute({ sql: translateSearchSqlForSqlite(countSql), args }),
  ])

  const rows = dataResult.rows.map(row =>
    normalizeAdvancedSearchRow(row as unknown as Record<string, unknown>)
  )
  const total = Number(
    (countResult.rows[0] as unknown as { total: number } | undefined)?.total ?? 0
  )

  return { rows, total }
}
