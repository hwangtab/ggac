/**
 * `user_sessions` 쿼리 계층 (Turso/Drizzle). 단계 4 Task 3(`활동로그·세션
 * 전환`)이 만든다. 짝은 `src/db/queries/activities.ts` — `manageUserSession`이
 * 로그인/로그아웃 활동을 기록할 때 그 모듈의 `logUserActivity`를 호출한다.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정(로그인 여부,
 * 관리자 여부)은 호출부(라우트의 `requireUser()`, `requireAdmin()`)의 몫이고,
 * 이 모듈의 모든 함수는 **이미 검증된 인자만** 받는다.
 *
 * 응답 형태는 snake_case다(CLAUDE.md, `src/types/activity.ts`의
 * `UserSession`/`ActiveUser`와 필드명이 정확히 일치한다).
 *
 * **`active_users_view`의 신규 회원 소실 문제(단계 2c 이월)**: 원본 Postgres
 * 뷰(20250719090020)는 `user_sessions us JOIN member_profiles mp ON
 * us.user_id = mp.id`를 **INNER JOIN**으로 썼다. 그 시절 `user_sessions.user_id`는
 * `auth.users(id)`를 참조했다 — `member_profiles`가 아니다 — 이라
 * `auth.users` 행은 즉시 생겼는데 `member_profiles` 행 생성이 뒤처지면(가입
 * 훅 지연·실패) 새로 로그인한 회원의 세션이 INNER JOIN에서 통째로 걸러져
 * 실시간 접속자 패널에서 사라졌다.
 *
 * Turso 스키마(`src/db/schema/ops.ts`)에서는 `userSessions.userId`가
 * **`member_profiles.id`를 직접 참조하는 FK**(`ON DELETE CASCADE`)다 — 이
 * 저장소의 `@libsql/client`는 FK를 강제한다(`scripts/testing/
 * queriesNotifications.test.mjs`가 이미 FK 위반을 확인한다). 즉 `user_sessions`에
 * 유효하지 않은 `user_id`를 가진 행은 애초에 존재할 수 없다 — 원본 버그의
 * 전제(세션은 있는데 프로필은 없는 시점)가 스키마 수준에서 구조적으로
 * 불가능해졌다. 그럼에도 `listActiveUsers`는 **LEFT JOIN**을 쓴다 — FK가
 * 보장을 무너뜨리지 않는 한 결과는 INNER JOIN과 같지만(고아 세션이 없으므로),
 * 이 함수가 "프로필이 없다고 세션을 숨기지 않는다"는 의도를 코드 자체에 남기고
 * (COALESCE로 표시 이름 폴백), 스키마가 느슨해지는 미래 변경에도 이 라우트가
 * 조용히 다시 회귀하지 않게 하는 방어선이다.
 */

import { and, count, desc, eq, gt, gte } from 'drizzle-orm'

import { db } from '../client.ts'
import { memberProfiles, userActivities, userSessions } from '../schema/index.ts'

import { logUserActivity, todayStartUtc } from './activities.ts'
import { toIso } from './_helpers.ts'

// -------------------------------------------------------------------------
// 쓰기 — manage_user_session RPC 대체
// -------------------------------------------------------------------------

export interface ManageSessionInput {
  user_id: string
  session_token: string
  action: 'start' | 'update' | 'end'
  ip_address?: string | null
  user_agent?: string | null
  metadata?: Record<string, unknown>
}

async function startSession(
  input: Required<Omit<ManageSessionInput, 'action'>>,
  onActivityLogError?: (error: unknown) => void
): Promise<string> {
  const sessionId = await db.transaction(async tx => {
    // 기존 활성 세션 종료 — 원본과 동일하게 로그아웃 활동은 기록하지 않는다
    // (원본 RPC의 'start' 분기도 이전 세션 종료는 조용히 처리했다).
    await tx
      .update(userSessions)
      .set({ isActive: false, logoutAt: new Date() })
      .where(and(eq(userSessions.userId, input.user_id), eq(userSessions.isActive, true)))

    const [row] = await tx
      .insert(userSessions)
      .values({
        userId: input.user_id,
        sessionToken: input.session_token,
        ipAddress: input.ip_address,
        userAgent: input.user_agent,
        metadata: input.metadata,
      })
      .returning({ id: userSessions.id })

    return row.id
  })

  // 로그인 활동 기록 — 세션 시작 자체를 막지 않는다(activities.ts 모듈 설명,
  // 브리프 필수 조건 1번). 세션은 이미 커밋됐으므로 실패해도 삼키지 않고
  // `onActivityLogError`로 알린 뒤 sessionId를 그대로 반환한다.
  try {
    await logUserActivity({
      user_id: input.user_id,
      action_type: 'login',
      target_type: 'system',
      target_id: null,
      metadata: input.metadata,
      ip_address: input.ip_address,
      user_agent: input.user_agent,
      session_id: sessionId,
    })
  } catch (error) {
    onActivityLogError?.(error)
  }

  return sessionId
}

async function updateSession(
  sessionToken: string,
  metadata: Record<string, unknown>
): Promise<string | null> {
  const [row] = await db
    .update(userSessions)
    .set({ lastActivity: new Date(), metadata })
    .where(and(eq(userSessions.sessionToken, sessionToken), eq(userSessions.isActive, true)))
    .returning({ id: userSessions.id })
  return row?.id ?? null
}

async function endSession(
  input: Required<Omit<ManageSessionInput, 'action'>>,
  onActivityLogError?: (error: unknown) => void
): Promise<string | null> {
  const [row] = await db
    .update(userSessions)
    .set({ isActive: false, logoutAt: new Date() })
    .where(and(eq(userSessions.sessionToken, input.session_token), eq(userSessions.isActive, true)))
    .returning({ id: userSessions.id })
  const sessionId = row?.id ?? null

  // 원본 RPC는 매칭되는 활성 세션이 없어도(session_id가 NULL이어도)
  // 로그아웃 활동을 무조건 기록했다 — 그대로 재현한다. 세션 종료 자체는
  // 이미 끝났으므로(위 UPDATE), 활동 기록 실패는 삼키지 않고 알린 뒤
  // sessionId를 그대로 반환한다.
  try {
    await logUserActivity({
      user_id: input.user_id,
      action_type: 'logout',
      target_type: 'system',
      target_id: null,
      metadata: input.metadata,
      ip_address: input.ip_address,
      user_agent: input.user_agent,
      session_id: sessionId,
    })
  } catch (error) {
    onActivityLogError?.(error)
  }

  return sessionId
}

/**
 * `manage_user_session` RPC 대체. `p_action`에 따라 세션을 시작/갱신/종료하고
 * (원본과 동일하게) 시작·종료 시 로그인/로그아웃 활동을 기록한다.
 * **세션 쓰기 자체는 성공했는데 활동 기록만 실패한 경우, 이 함수는 그 실패를
 * 삼키지 않고 `onActivityLogError`로 알리되(호출부가 로그를 남길 수 있게),
 * 세션 작업 결과(반환값)는 그대로 돌려준다** — 활동 기록은 부가 효과이고
 * 세션 시작/종료가 "본 작업"이기 때문이다(브리프 필수 조건 1번, 모듈 설명의
 * "뜨거운 경로" 원칙을 세션에도 적용한 것). `onActivityLogError`를 생략하면
 * 활동 기록 실패는 조용히 버려진다 — 호출부가 로그를 남기고 싶다면 반드시
 * 넘겨야 한다(대부분의 호출부는 넘긴다, 아래 라우트 참고).
 * @returns 세션 id. `update`/`end`에서 매칭되는 활성 세션이 없으면 `null`
 * (원본 RPC가 `RETURNING`에서 아무 것도 못 얻으면 `session_id`가 NULL로
 * 남는 것과 동일).
 * @throws 세션 쓰기 자체(INSERT/UPDATE)가 실패하면 그대로 던진다(삼키지
 * 않는다).
 */
export async function manageUserSession(
  input: ManageSessionInput,
  onActivityLogError?: (error: unknown) => void
): Promise<string | null> {
  const normalized: Required<Omit<ManageSessionInput, 'action'>> = {
    user_id: input.user_id,
    session_token: input.session_token,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    metadata: input.metadata ?? {},
  }

  if (input.action === 'start') return startSession(normalized, onActivityLogError)
  if (input.action === 'update') return updateSession(normalized.session_token, normalized.metadata)
  if (input.action === 'end') return endSession(normalized, onActivityLogError)
  return null
}

// -------------------------------------------------------------------------
// 읽기 — 세션 목록 (관리자 분석 라우트 공용 빌딩 블록)
// -------------------------------------------------------------------------

export interface SessionRow {
  id: string
  user_id: string | null
  session_token: string
  last_activity: string
  is_active: boolean
  ip_address: string | null
  user_agent: string | null
  login_at: string
  logout_at: string | null
  metadata: Record<string, unknown>
}

export interface ListSessionsFilter {
  userId?: string | null
  loginAfter: Date
}

/**
 * `user_sessions`를 필터로 조회한다. `/api/admin/analytics/patterns`
 * (`analyzeUserBehavior`/`analyzeSessionPatterns`)·`/api/admin/analytics/trends`
 * (`getUserTrends`의 활성 세션 조회·`getPerformanceTrends`)가 각자 만들던
 * 수동 Supabase 쿼리를 대체하는 공용 빌딩 블록이다.
 */
export async function listSessions(filter: ListSessionsFilter): Promise<SessionRow[]> {
  const conditions = [gte(userSessions.loginAt, filter.loginAfter)]
  if (filter.userId) conditions.push(eq(userSessions.userId, filter.userId))

  const rows = await db
    .select()
    .from(userSessions)
    .where(and(...conditions))
    .orderBy(userSessions.loginAt)

  return rows.map(row => ({
    id: row.id,
    user_id: row.userId,
    session_token: row.sessionToken,
    last_activity: toIso(row.lastActivity) as string,
    is_active: row.isActive,
    ip_address: row.ipAddress,
    user_agent: row.userAgent,
    login_at: toIso(row.loginAt) as string,
    logout_at: toIso(row.logoutAt),
    metadata: row.metadata ?? {},
  }))
}

// -------------------------------------------------------------------------
// 읽기 — active_users_view 대체
// -------------------------------------------------------------------------

export interface ActiveUserRow {
  user_id: string
  display_name: string
  email: string
  last_activity: string
  ip_address: string | null
  activity_count_today: number
  session_token: string
  minutes_since_activity: number
}

const ACTIVE_SESSION_WINDOW_MS = 30 * 60 * 1000

/**
 * `active_users_view` 대체. 모듈 설명의 LEFT JOIN 근거 참고. 원본 SQL:
 * ```sql
 * SELECT us.user_id, mp.display_name, mp.email, us.last_activity, us.ip_address,
 *   COUNT(ua.id) as activity_count_today, us.session_token,
 *   EXTRACT(EPOCH FROM (NOW() - us.last_activity)) / 60 as minutes_since_activity
 * FROM user_sessions us
 * JOIN member_profiles mp ON us.user_id = mp.id
 * LEFT JOIN user_activities ua ON ua.user_id = us.user_id AND ua.created_at >= CURRENT_DATE
 * WHERE us.is_active = TRUE AND us.last_activity > NOW() - INTERVAL '30 minutes'
 * GROUP BY us.user_id, mp.display_name, mp.email, us.last_activity, us.ip_address, us.session_token
 * ORDER BY us.last_activity DESC;
 * ```
 */
export async function listActiveUsers(limit: number): Promise<ActiveUserRow[]> {
  const cutoff = new Date(Date.now() - ACTIVE_SESSION_WINDOW_MS)
  const todayStart = todayStartUtc()

  const rows = await db
    .select({
      userId: userSessions.userId,
      displayName: memberProfiles.displayName,
      email: memberProfiles.email,
      lastActivity: userSessions.lastActivity,
      ipAddress: userSessions.ipAddress,
      sessionToken: userSessions.sessionToken,
      activityCountToday: count(userActivities.id),
    })
    .from(userSessions)
    .leftJoin(memberProfiles, eq(userSessions.userId, memberProfiles.id))
    .leftJoin(
      userActivities,
      and(eq(userActivities.userId, userSessions.userId), gte(userActivities.createdAt, todayStart))
    )
    .where(and(eq(userSessions.isActive, true), gt(userSessions.lastActivity, cutoff)))
    .groupBy(
      userSessions.userId,
      memberProfiles.displayName,
      memberProfiles.email,
      userSessions.lastActivity,
      userSessions.ipAddress,
      userSessions.sessionToken
    )
    .orderBy(desc(userSessions.lastActivity))
    .limit(limit)

  const now = Date.now()
  return rows.map(row => ({
    user_id: row.userId as string,
    display_name: row.displayName ?? '(프로필 없음)',
    email: row.email ?? '',
    last_activity: toIso(row.lastActivity) as string,
    ip_address: row.ipAddress,
    activity_count_today: Number(row.activityCountToday),
    session_token: row.sessionToken,
    minutes_since_activity: (now - (row.lastActivity as unknown as Date).getTime()) / 60_000,
  }))
}
