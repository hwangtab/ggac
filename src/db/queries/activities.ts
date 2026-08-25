/**
 * `user_activities`/`daily_activity_stats` 쿼리 계층 (Turso/Drizzle). 단계 4
 * Task 3(`활동로그·세션 전환`)이 만든다.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정(로그인 여부,
 * 관리자 여부, 본인 활동만 기록)은 호출부(라우트의 `requireUser()`,
 * `requireAdmin()`)의 몫이고, 이 모듈의 모든 함수는 **이미 검증된 인자만**
 * 받는다.
 *
 * 응답 형태는 snake_case다 — `src/db/queries/notifications.ts`·`posts.ts`와
 * 같은 이유(CLAUDE.md, strict: false라 키가 바뀌어도 타입 검사가 못 잡고
 * 화면이 조용히 빈다). 필드명은 기존 `src/types/activity.ts`(`UserActivity`/
 * `ActivityStats`/`ActivityFeedItem`/`WeeklyActivityStats`)와 정확히 일치한다.
 *
 * **`logUserActivity`는 뜨거운 경로다** — 좋아요·조회 등 거의 모든 상호작용에서
 * 호출된다. `createNotification`(notifications.ts)과 같은 계약을 따른다 —
 * **실패하면 그대로 throw한다(삼키지 않는다)**. 이 함수 자체가 실패를 삼키면
 * "실패했는데 아무도 모른다"는 사고가 반복된다(이 저장소에서 알림이 1년간
 * 죽어 있었던 전례, 브리프 명시). 대신 **호출부가** try/catch로 감싸고 로그를
 * 남긴다 — 좋아요·조회수 증가 같은 "본 작업"이 활동 기록 실패로 막히면 안
 * 되기 때문이다(브리프 필수 조건 1번). `src/app/api/posts/[id]/likes/route.ts`·
 * `src/app/auth/callback/route.ts`가 이미 이 패턴이었다(Supabase RPC 시절부터).
 * `src/db/queries/sessions.ts`의 `manageUserSession`도 세션 시작/종료 안에서
 * 로그인/로그아웃 활동을 기록할 때 같은 패턴(catch + 로그, 세션 작업 자체는
 * 막지 않음)을 쓴다.
 *
 * **`logUserActivitiesBatch`는 배치 INSERT 한 번이다 — 로그당 도는 루프가
 * 아니다.** `log_user_activities_batch` RPC(20260710213000)가 배치 엔드포인트의
 * "로그당 RPC 호출로 최대 100 왕복" 문제(전수감사 API Medium 9)를 고치려고
 * 만들어졌다 — 이 함수가 그 이유를 다시 무너뜨리면 안 된다
 * (`scripts/testing/queriesActivities.test.mjs`의 소스 가드가 정적으로
 * 확인한다).
 */

import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  ACTIVITY_ACTION_TYPE,
  ACTIVITY_TARGET_TYPE,
  dailyActivityStats,
  memberProfiles,
  userActivities,
} from '../schema/index.ts'

import { toIso } from './_helpers.ts'

export type ActivityActionTypeValue = (typeof ACTIVITY_ACTION_TYPE)[number]
export type ActivityTargetTypeValue = (typeof ACTIVITY_TARGET_TYPE)[number]

/** 오늘 날짜를 `daily_activity_stats.activity_date`(text, 'YYYY-MM-DD') 형식으로. UTC 기준. */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 오늘 00:00:00.000 UTC. `active_users_view`의 `CURRENT_DATE` 대응(sessions.ts에서도 쓴다). */
export function todayStartUtc(): Date {
  return new Date(`${todayDateString()}T00:00:00.000Z`)
}

// -------------------------------------------------------------------------
// 쓰기 — log_user_activity / log_user_activities_batch RPC 대체
// -------------------------------------------------------------------------

export interface LogActivityInput {
  user_id: string
  action_type: ActivityActionTypeValue
  target_type?: ActivityTargetTypeValue | null
  target_id?: string | null
  metadata?: Record<string, unknown>
  ip_address?: string | null
  user_agent?: string | null
  session_id?: string | null
}

/**
 * 활동 로그 하나를 기록하고, `daily_activity_stats`의 (오늘, 이 사용자, 이
 * 액션타입) 카운트를 1 증가시킨다(없으면 생성). `log_user_activity` RPC
 * 대체 — 원본은 단일 plpgsql 함수라 두 쓰기가 한 트랜잭션이었다.
 *
 * **`db.transaction()`이 아니라 `db.batch()`를 쓴다.** 이 함수는 뜨거운
 * 경로다(모듈 설명 참고) — `db.transaction()`(대화형 트랜잭션, BEGIN·
 * INSERT·INSERT·COMMIT 각각 별도 왕복)은 원격 Turso에서 좋아요 1회에
 * 최소 4번의 네트워크 왕복을 만들어 응답을 블로킹했다(코드리뷰 지적).
 * 두 INSERT는 서로의 실행 결과에 의존하지 않으므로(두 번째 INSERT에
 * 필요한 값 — activityDate/user_id/action_type — 은 이미 인자로 갖고
 * 있다) `db.batch([...])`로 한 번의 왕복에 묶을 수 있다. libsql의
 * batch()는 내부적으로 `BEGIN`으로 감싸 하나라도 실패하면 전체를
 * 롤백한다(`@libsql/client`의 sqlite3/http/ws 드라이버 공통 동작) —
 * `db.transaction()`과 원자성은 동일하고 왕복만 줄었다.
 * @returns 새로 생성된 활동 로그의 id(원본 RPC가 `RETURNING id`로 돌려주던
 * uuid와 동일한 모양).
 * @throws DB 쓰기가 실패하면 그대로 던진다(삼키지 않는다) — 모듈 설명 참고.
 */
export async function logUserActivity(input: LogActivityInput): Promise<string> {
  const activityDate = todayDateString()

  const insertActivity = db
    .insert(userActivities)
    .values({
      userId: input.user_id,
      actionType: input.action_type,
      targetType: input.target_type ?? null,
      targetId: input.target_id ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.ip_address ?? null,
      userAgent: input.user_agent ?? null,
      sessionId: input.session_id ?? null,
    })
    .returning({ id: userActivities.id })

  const upsertDailyStat = db
    .insert(dailyActivityStats)
    .values({
      activityDate,
      userId: input.user_id,
      actionType: input.action_type,
      count: 1,
    })
    .onConflictDoUpdate({
      target: [
        dailyActivityStats.activityDate,
        dailyActivityStats.userId,
        dailyActivityStats.actionType,
      ],
      set: {
        count: sql`${dailyActivityStats.count} + 1`,
        lastUpdated: new Date(),
      },
    })

  const [insertedActivityRows] = await db.batch([insertActivity, upsertDailyStat])
  return insertedActivityRows[0].id
}

export interface LogActivityBatchEntry {
  action_type: ActivityActionTypeValue
  target_type?: ActivityTargetTypeValue | null
  target_id?: string | null
  metadata?: Record<string, unknown>
  session_id?: string | null
}

/**
 * 같은 사용자의 활동 로그 여러 건을 한 번에 기록한다. `log_user_activities_batch`
 * RPC(20260710213000) 대체. `logs`가 비면 쓰기 없이 0을 반환한다(원본의
 * `p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array'` 분기와 동일한 결과).
 * `daily_activity_stats`는 원본처럼 액션타입별로 묶어(그룹당 최대
 * `ACTIVITY_ACTION_TYPE.length`행) 한 번에 upsert한다 — **로그 건수만큼
 * upsert하지 않는다**(N+1 방지, 모듈 설명 참고).
 * @returns 실제로 삽입된 로그 수(원본 RPC의 `RETURN inserted_count`와 동일).
 * @throws DB 쓰기가 실패하면 그대로 던진다(삼키지 않는다) — 부분 삽입 없이
 * 트랜잭션 전체가 롤백된다.
 */
export async function logUserActivitiesBatch(
  userId: string,
  logs: LogActivityBatchEntry[],
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<number> {
  if (!Array.isArray(logs) || logs.length === 0) return 0

  const activityDate = todayDateString()

  return db.transaction(async tx => {
    const inserted = await tx
      .insert(userActivities)
      .values(
        logs.map(entry => ({
          userId,
          actionType: entry.action_type,
          targetType: entry.target_type ?? null,
          targetId: entry.target_id ?? null,
          metadata: entry.metadata ?? {},
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          sessionId: entry.session_id ?? null,
        }))
      )
      .returning({ actionType: userActivities.actionType })

    const countsByAction = new Map<string, number>()
    for (const row of inserted) {
      countsByAction.set(row.actionType, (countsByAction.get(row.actionType) ?? 0) + 1)
    }

    if (countsByAction.size > 0) {
      await tx
        .insert(dailyActivityStats)
        .values(
          [...countsByAction.entries()].map(([actionType, groupCount]) => ({
            activityDate,
            userId,
            actionType: actionType as ActivityActionTypeValue,
            count: groupCount,
          }))
        )
        .onConflictDoUpdate({
          target: [
            dailyActivityStats.activityDate,
            dailyActivityStats.userId,
            dailyActivityStats.actionType,
          ],
          set: {
            count: sql`${dailyActivityStats.count} + excluded.${sql.identifier('count')}`,
            lastUpdated: new Date(),
          },
        })
    }

    return inserted.length
  })
}

// -------------------------------------------------------------------------
// 읽기 — 활동 목록 (관리자 분석 라우트 공용 빌딩 블록)
// -------------------------------------------------------------------------

export interface ActivityRow {
  id: string
  user_id: string | null
  action_type: ActivityActionTypeValue
  target_type: ActivityTargetTypeValue | null
  target_id: string | null
  metadata: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
  session_id: string | null
  created_at: string
}

function rowToActivity(row: typeof userActivities.$inferSelect): ActivityRow {
  return {
    id: row.id,
    user_id: row.userId,
    action_type: row.actionType as ActivityActionTypeValue,
    target_type: row.targetType as ActivityTargetTypeValue | null,
    target_id: row.targetId,
    metadata: row.metadata ?? {},
    ip_address: row.ipAddress,
    user_agent: row.userAgent,
    session_id: row.sessionId,
    created_at: toIso(row.createdAt) as string,
  }
}

export interface ListActivitiesFilter {
  userId?: string | null
  startDate: Date
  endDate?: Date | null
  actionTypes?: ActivityActionTypeValue[]
  /** metadata.generated === true 인 행을 제외한다(admin/analytics/patterns의
   * `exclude_test` 옵션 — 원본은 Postgres JSONB 포함 연산자 `.not('metadata',
   * 'cs', '{"generated":true}')`였다). */
  excludeGeneratedMetadata?: boolean
}

/**
 * `user_activities`를 필터로 조회한다. 기존 여러 admin 분석 라우트
 * (`/api/admin/analytics/patterns`의 `analyzeActivityPatterns`/
 * `analyzeContentEngagement`, `/api/admin/analytics/trends`의
 * `getEngagementTrends`, `/api/admin/reports/generate`의
 * `generateMemberActivityReport`)가 각자 만들던 수동 Supabase 쿼리를
 * 대체하는 공용 빌딩 블록이다 — `created_at` 오름차순으로 반환한다(원본
 * 라우트들은 정렬을 요구하지 않았지만, 안정적인 순서를 위해 생성 시각
 * 오름차순으로 고정했다).
 */
export async function listActivities(filter: ListActivitiesFilter): Promise<ActivityRow[]> {
  const conditions: SQL[] = [gte(userActivities.createdAt, filter.startDate)]
  if (filter.endDate) {
    // 원본 admin/reports/generate의 `.lte('created_at', endDate.toISOString())`와
    // 동일하게 endDate를 포함한다(배타적 lt가 아니다) — 코드리뷰 지적.
    conditions.push(lte(userActivities.createdAt, filter.endDate))
  }
  if (filter.userId) {
    conditions.push(eq(userActivities.userId, filter.userId))
  }
  if (filter.actionTypes && filter.actionTypes.length > 0) {
    conditions.push(inArray(userActivities.actionType, filter.actionTypes))
  }
  if (filter.excludeGeneratedMetadata) {
    conditions.push(sql`coalesce(json_extract(${userActivities.metadata}, '$.generated'), 0) != 1`)
  }

  const rows = await db
    .select()
    .from(userActivities)
    .where(and(...conditions))
    .orderBy(asc(userActivities.createdAt))

  return rows.map(rowToActivity)
}

export interface ListActivitiesPaginatedFilter {
  userId?: string | null
  actionType?: ActivityActionTypeValue | null
  targetType?: ActivityTargetTypeValue | null
  startDate: Date
  /** 1부터. */
  page: number
  limit: number
}

export interface ActivityWithProfileRow extends ActivityRow {
  /** Supabase의 `member_profiles!user_id (display_name, email)` 임베드와
   * 같은 모양 — 프로필이 없으면(탈퇴 등으로 `user_id`가 NULL이 된 경우) `null`. */
  member_profiles: { display_name: string; email: string } | null
}

/**
 * `/api/admin/activities/users`의 페이지네이션 목록. 기존 수동 Supabase 쿼리
 * (`member_profiles!user_id (display_name, email)` 임베드 + `{count:'exact'}`
 * + `.range()`) 대체 — `created_at` 내림차순, 필터(`user_id`/`action_type`/
 * `target_type`)와 페이지네이션(`total`)을 그대로 유지한다.
 */
export async function listActivitiesWithProfile(
  filter: ListActivitiesPaginatedFilter
): Promise<{ rows: ActivityWithProfileRow[]; total: number }> {
  const conditions: SQL[] = [gte(userActivities.createdAt, filter.startDate)]
  if (filter.userId) conditions.push(eq(userActivities.userId, filter.userId))
  if (filter.actionType) conditions.push(eq(userActivities.actionType, filter.actionType))
  if (filter.targetType) conditions.push(eq(userActivities.targetType, filter.targetType))
  const where = and(...conditions) as SQL

  const offset = Math.max(0, (filter.page - 1) * filter.limit)

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        activity: userActivities,
        displayName: memberProfiles.displayName,
        email: memberProfiles.email,
      })
      .from(userActivities)
      .leftJoin(memberProfiles, eq(userActivities.userId, memberProfiles.id))
      .where(where)
      .orderBy(desc(userActivities.createdAt))
      .limit(filter.limit)
      .offset(offset),
    db.select({ value: count() }).from(userActivities).where(where),
  ])

  return {
    rows: rows.map(row => ({
      ...rowToActivity(row.activity),
      member_profiles:
        row.displayName !== null
          ? { display_name: row.displayName, email: row.email as string }
          : null,
    })),
    total: totalRows[0]?.value ?? 0,
  }
}

// -------------------------------------------------------------------------
// 읽기 — get_user_activity_stats RPC 대체
// -------------------------------------------------------------------------

export interface ActivityStatsRow {
  action_type: ActivityActionTypeValue
  total_count: number
  unique_days: number
  avg_per_day: number
  first_activity: string
  last_activity: string
}

export interface GetActivityStatsFilter {
  /** `null`/미지정이면 전체 사용자 대상(원본 RPC의 `p_user_id IS NULL`과 동일). */
  userId?: string | null
  /** 이 날짜의 00:00:00.000(포함)부터. */
  startDate: Date
  /** 이 날짜의 23:59:59.999(포함)까지. */
  endDate: Date
}

/**
 * `get_user_activity_stats` RPC 대체. 원본은
 * `DATE(created_at) BETWEEN p_start_date AND p_end_date`(둘 다 DATE)였다 —
 * 여기서는 `startDate`의 00:00:00.000부터 `endDate`의 다음 날 00:00:00.000
 * 직전까지로 옮겨 같은 "그 날짜를 포함한 하루 전체"를 SQLite 타임스탬프
 * 비교로 재현한다. `avg_per_day`는 `ROUND(total/GREATEST(unique_days,1),2)`를
 * JS에서 그대로 계산한다(SQLite에 `GREATEST`가 없다).
 */
export async function getUserActivityStats(
  filter: GetActivityStatsFilter
): Promise<ActivityStatsRow[]> {
  const endExclusive = new Date(filter.endDate)
  endExclusive.setUTCHours(24, 0, 0, 0)
  const startInclusive = new Date(filter.startDate)
  startInclusive.setUTCHours(0, 0, 0, 0)

  const conditions: SQL[] = [
    gte(userActivities.createdAt, startInclusive),
    lt(userActivities.createdAt, endExclusive),
  ]
  if (filter.userId) {
    conditions.push(eq(userActivities.userId, filter.userId))
  }

  const dateExpr = sql`date(${userActivities.createdAt} / 1000, 'unixepoch')`

  const rows = await db
    .select({
      actionType: userActivities.actionType,
      totalCount: count(),
      uniqueDays: sql<number>`count(distinct ${dateExpr})`,
      firstActivity: sql<number>`min(${userActivities.createdAt})`,
      lastActivity: sql<number>`max(${userActivities.createdAt})`,
    })
    .from(userActivities)
    .where(and(...conditions))
    .groupBy(userActivities.actionType)

  return rows
    .map(row => {
      const totalCount = Number(row.totalCount)
      const uniqueDays = Number(row.uniqueDays)
      return {
        action_type: row.actionType as ActivityActionTypeValue,
        total_count: totalCount,
        unique_days: uniqueDays,
        avg_per_day: Math.round((totalCount / Math.max(uniqueDays, 1)) * 100) / 100,
        first_activity: new Date(Number(row.firstActivity)).toISOString(),
        last_activity: new Date(Number(row.lastActivity)).toISOString(),
      }
    })
    .sort((a, b) => b.total_count - a.total_count)
}

// -------------------------------------------------------------------------
// 읽기 — get_real_time_activity_feed RPC 대체
// -------------------------------------------------------------------------

export interface ActivityFeedFilter {
  limit: number
  /** 비어 있거나 미지정이면 전체 액션타입(원본 RPC의 `p_action_types IS NULL`과 동일). */
  actionTypes?: ActivityActionTypeValue[] | null
}

export interface ActivityFeedRow {
  id: string
  user_id: string
  user_name: string
  action_type: ActivityActionTypeValue
  target_type: ActivityTargetTypeValue | null
  target_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  time_ago_text: string
}

function formatTimeAgo(diffMs: number): string {
  if (diffMs < 60_000) return '방금 전'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}분 전`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}시간 전`
  return `${Math.floor(diffMs / 86_400_000)}일 전`
}

/**
 * `get_real_time_activity_feed` RPC 대체. 원본처럼 `member_profiles`를
 * INNER JOIN한다 — `user_activities.user_id`는 `ON DELETE SET NULL`이라
 * (`src/db/schema/ops.ts`) 탈퇴한 사용자의 행은 `user_id`가 NULL이 되고,
 * INNER JOIN이 그 행을 자연히 걸러낸다(원본 SQL의 `ua.user_id = mp.id` 조인
 * 조건이 NULL이면 매치되지 않는 것과 같은 결과). FK가 있는 한(user_id가
 * NOT NULL이면 항상 유효한 member_profiles를 가리킨다) 신규 회원이 이
 * 목록에서 사라지는 문제는 없다 — `active_users_view` 대체(`sessions.ts`의
 * `listActiveUsers`)와 달리 여기서는 LEFT JOIN으로 바꿀 이유가 없다.
 */
export async function getRealTimeActivityFeed(
  filter: ActivityFeedFilter
): Promise<ActivityFeedRow[]> {
  const conditions: SQL[] = [
    gt(userActivities.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
  ]
  if (filter.actionTypes && filter.actionTypes.length > 0) {
    conditions.push(inArray(userActivities.actionType, filter.actionTypes))
  }

  const rows = await db
    .select({
      id: userActivities.id,
      userId: userActivities.userId,
      userName: memberProfiles.displayName,
      actionType: userActivities.actionType,
      targetType: userActivities.targetType,
      targetId: userActivities.targetId,
      metadata: userActivities.metadata,
      createdAt: userActivities.createdAt,
    })
    .from(userActivities)
    .innerJoin(memberProfiles, eq(userActivities.userId, memberProfiles.id))
    .where(and(...conditions))
    .orderBy(desc(userActivities.createdAt))
    .limit(filter.limit)

  const now = Date.now()
  return rows.map(row => ({
    id: row.id,
    user_id: row.userId as string,
    user_name: row.userName,
    action_type: row.actionType as ActivityActionTypeValue,
    target_type: row.targetType as ActivityTargetTypeValue | null,
    target_id: row.targetId,
    metadata: row.metadata ?? {},
    created_at: toIso(row.createdAt) as string,
    time_ago_text: formatTimeAgo(now - (row.createdAt as unknown as Date).getTime()),
  }))
}

// -------------------------------------------------------------------------
// 읽기 — weekly_activity_stats 뷰 대체
// -------------------------------------------------------------------------

export interface WeeklyActivityStatsRow {
  week_start: string
  action_type: ActivityActionTypeValue
  total_count: number
  unique_users: number
  avg_time_between_actions: number | null
}

const WEEKLY_STATS_WINDOW_WEEKS = 8

/** ISO 주(월요일 시작) 00:00:00.000 UTC. Postgres `DATE_TRUNC('week', ts)` 대응. */
function mondayStartUtc(d: Date): Date {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday))
}

/**
 * `weekly_activity_stats` 뷰 대체. 원본 정의(20250719090020):
 * ```sql
 * WITH activity_intervals AS (
 *   SELECT DATE_TRUNC('week', created_at) as week_start, action_type, user_id, created_at,
 *     EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (
 *       PARTITION BY user_id ORDER BY created_at))) as time_diff_seconds
 *   FROM user_activities WHERE created_at >= NOW() - INTERVAL '8 weeks'
 * )
 * SELECT week_start, action_type, COUNT(*) as total_count, COUNT(DISTINCT user_id) as unique_users,
 *   AVG(time_diff_seconds) as avg_time_between_actions
 * FROM activity_intervals GROUP BY week_start, action_type ORDER BY week_start DESC, total_count DESC;
 * ```
 * SQLite에는 `LAG()`/`DATE_TRUNC`가 없어(정확히는 `LAG`는 SQLite도 지원하지만
 * `PARTITION BY user_id ORDER BY created_at` 윈도를 안정적으로 표현하려면
 * 인접 행 비교를 애플리케이션에서 하는 편이 실수하기 더 어렵다) 지난 8주
 * 활동을 (user_id, created_at) 순으로 통째로 읽어 자바스크립트에서 인접 행
 * 시간차를 계산한다 — 이 앱 규모(회원 23명, 활동 11,083행 실측)에서는 문제
 * 없다. **원본과의 알려진 차이 하나**: `user_id`가 NULL인 행(탈퇴 회원의
 * 활동 — `ON DELETE SET NULL`)은 시간차 계산에서 제외한다(원본 Postgres는
 * NULL도 하나의 파티션으로 묶어 LAG를 계산했지만, 여기서는 안정성을 위해
 * 제외했다) — `avg_time_between_actions`는 현재 어떤 소비자도 읽지 않으므로
 * (관리자 트렌드/리포트 라우트는 `total_count`/`unique_users`만 쓴다) 이
 * 차이는 눈에 보이는 동작에 영향이 없다.
 *
 * 반환값은 원본 뷰처럼 `WHERE created_at >= NOW() - INTERVAL '8 weeks'`로
 * 고정된 창을 쓴다 — 소비 라우트(`analytics/trends`·`reports/generate`)가
 * 이미 그 위에 자신의 날짜 범위로 `.filter()`/재정렬을 하므로, 뷰의 원래
 * 계약(항상 최근 8주만 담고 있다)을 그대로 유지한다.
 */
export async function getWeeklyActivityStats(): Promise<WeeklyActivityStatsRow[]> {
  const windowStart = new Date(Date.now() - WEEKLY_STATS_WINDOW_WEEKS * 7 * 24 * 60 * 60 * 1000)

  const rows = await db
    .select({
      userId: userActivities.userId,
      actionType: userActivities.actionType,
      createdAt: userActivities.createdAt,
    })
    .from(userActivities)
    .where(gte(userActivities.createdAt, windowStart))
    .orderBy(asc(userActivities.userId), asc(userActivities.createdAt))

  const timeDiffSeconds: Array<number | null> = new Array(rows.length).fill(null)
  let prevUserId: string | null = null
  let prevCreatedAt: Date | null = null
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.userId !== null && row.userId === prevUserId && prevCreatedAt) {
      timeDiffSeconds[i] = ((row.createdAt as Date).getTime() - prevCreatedAt.getTime()) / 1000
    }
    prevUserId = row.userId
    prevCreatedAt = row.createdAt as Date
  }

  type Group = {
    weekStart: string
    actionType: string
    users: Set<string>
    rowCount: number
    diffSum: number
    diffCount: number
  }
  const groups = new Map<string, Group>()

  rows.forEach((row, i) => {
    const weekStart = mondayStartUtc(row.createdAt as Date).toISOString()
    const key = `${weekStart}::${row.actionType}`
    let group = groups.get(key)
    if (!group) {
      group = {
        weekStart,
        actionType: row.actionType,
        users: new Set(),
        rowCount: 0,
        diffSum: 0,
        diffCount: 0,
      }
      groups.set(key, group)
    }
    group.rowCount += 1
    if (row.userId) group.users.add(row.userId)
    const diff = timeDiffSeconds[i]
    if (diff !== null) {
      group.diffSum += diff
      group.diffCount += 1
    }
  })

  return [...groups.values()]
    .map(g => ({
      week_start: g.weekStart,
      action_type: g.actionType as ActivityActionTypeValue,
      total_count: g.rowCount,
      unique_users: g.users.size,
      avg_time_between_actions: g.diffCount > 0 ? g.diffSum / g.diffCount : null,
    }))
    .sort((a, b) => {
      if (a.week_start !== b.week_start) return b.week_start.localeCompare(a.week_start)
      return b.total_count - a.total_count
    })
}

// -------------------------------------------------------------------------
// 읽기 — daily_activity_stats 직접 조회 (admin/reports/generate)
// -------------------------------------------------------------------------

export interface DailyActivityStatRow {
  activity_date: string
  action_type: ActivityActionTypeValue
  count: number
}

/**
 * `daily_activity_stats`를 날짜 범위(포함)로 조회한다.
 * `/api/admin/reports/generate`의 `getDailyActivityBreakdown` 대체 — 원본
 * `.gte('activity_date', ...).lte('activity_date', ...).order('activity_date',
 * {ascending:true})`와 동일하게 `activity_date` 오름차순.
 */
export async function listDailyActivityStats(
  startDate: Date,
  endDate: Date
): Promise<DailyActivityStatRow[]> {
  const startStr = startDate.toISOString().slice(0, 10)
  const endStr = endDate.toISOString().slice(0, 10)

  const rows = await db
    .select()
    .from(dailyActivityStats)
    .where(
      and(
        gte(dailyActivityStats.activityDate, startStr),
        lte(dailyActivityStats.activityDate, endStr)
      )
    )
    .orderBy(asc(dailyActivityStats.activityDate))

  return rows.map(row => ({
    activity_date: row.activityDate,
    action_type: row.actionType as ActivityActionTypeValue,
    count: row.count,
  }))
}
