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
 * **`active_users_view`의 신규 회원 소실 문제(단계 2c 이월) — 정정**: 처음
 * 이 모듈은 "Turso의 FK가 원본 버그를 구조적으로 없앴다"고 적었지만
 * 틀렸다(코드리뷰 지적). 정확한 상태는 다음과 같다.
 *
 * 원본 Postgres 뷰(20250719090020)는 `user_sessions us JOIN member_profiles
 * mp ON us.user_id = mp.id`를 **INNER JOIN**으로 썼다. `user_sessions.user_id`는
 * `auth.users(id)`를 참조했다 — `member_profiles`가 아니다. `auth.users` 행은
 * 즉시 생겼는데 `member_profiles` 행 생성이 뒤처지면(가입 훅 지연·실패) 그
 * 회원의 세션은 INSERT까지는 성공하고, INNER JOIN이 그 행을 **조용히** 걸러
 * 실시간 접속자 패널에서 사라졌다.
 *
 * Turso 스키마(`src/db/schema/ops.ts`)에서는 `userSessions.userId`가
 * `member_profiles.id`를 직접 참조하는 FK다. `src/lib/auth/server.ts`의
 * 가입 훅(`databaseHooks.user.create.after`)은 `upsertProfile` 실패를
 * **의도적으로 삼킨다**("가입 자체를 실패시키지는 않는다", 283~293행) —
 * 즉 프로필 없는 better-auth 사용자는 Turso에서도 여전히 발생할 수 있다.
 * 그 사용자가 로그인하면: `startSession`의 `INSERT INTO user_sessions`가
 * **FK 위반으로 실패**한다 → 세션 행 자체가 생기지 않는다 → 관리자가 그
 * 회원을 여전히 못 본다. **결과(못 본다)는 원본과 같다 — 실패 지점이
 * "조용한 INNER JOIN 필터링"에서 "시끄러운 세션 INSERT 실패"로 옮겨갔을
 * 뿐이다.** 그 실패가 세션 핑 자체를 500으로 막지 않도록 하는 처리는
 * `startSession`의 FK 위반 분기(아래) 참고 — "회원이 안 보인다"는 여전히
 * 남아 있는 별도 문제고, 이 모듈이 고치는 범위 밖이다(프로필 upsert
 * 실패를 삼키지 않게 만드는 건 `src/lib/auth/server.ts`의 몫이다).
 *
 * **`listActiveUsers`가 그래도 LEFT JOIN을 쓰는 이유**: 위 시나리오에서는
 * 세션 행 자체가 없으므로 LEFT JOIN이 발동할 여지가 없다 — 그 시나리오의
 * 해법이 아니다. LEFT JOIN이 실제로 의미를 갖는 유일한 경로는
 * `user_sessions.user_id IS NULL`인 행이다 — `--null-orphan-fk` 이관
 * 옵션(`scripts/migrate/stage4.mjs`)이 고아 FK를 NULL로 바꿔 이관할 때만
 * 생긴다. `listActiveUsers: 이관 고아 세션(user_id NULL)도 표시명 폴백으로
 * 나타난다` 테스트(`queriesSessions.test.mjs`)가 그 경로가 실제로 발동하는지
 * (원본 INNER JOIN이라면 걸러졌을 행이 폴백 표시명으로 뜨는지) 직접 확인한다
 * — 죽은 코드로 남겨두지 않는다.
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

/** `error`가 SQLite FOREIGN KEY 제약 위반인지 판별한다(메시지 기반 —
 * `queriesNotifications.test.mjs`/`queriesActivities.test.mjs`가 이미 쓰는
 * 판별 방식과 동일). 연결 장애 등 다른 종류의 실패는 여기 안 걸리고 그대로
 * 다시 던져진다 — FK 위반만 "본 작업을 막지 않는" 특별 취급을 받는다. */
function isForeignKeyViolation(error: unknown): boolean {
  const err = error as { message?: string; cause?: { message?: string } }
  const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
  return /FOREIGN KEY|FOREIGNKEY/.test(combined)
}

async function startSession(
  input: Required<Omit<ManageSessionInput, 'action'>>,
  onWriteError?: (error: unknown) => void
): Promise<string | null> {
  let sessionId: string
  try {
    sessionId = await db.transaction(async tx => {
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
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      // 프로필이 아직 없는 사용자의 세션 시작 — src/lib/auth/server.ts의
      // 가입 훅이 upsertProfile 실패를 삼키는 경로(모듈 설명 참고) 때문에
      // 실제로 재현 가능하다. 세션 핑은 activities.ts의 "본 작업을 막지
      // 않는다" 원칙을 그대로 적용받는 부가 기능이다 — 이 실패로 그 회원의
      // 세션 핑 자체가 500으로 죽으면 안 된다(코드리뷰가 지적한 신규
      // 회귀). 로그인 활동 기록도 같은 FK로 실패할 것이므로 시도하지
      // 않는다.
      onWriteError?.(error)
      return null
    }
    // FK 위반이 아닌 실패(연결 장애 등)는 삼키지 않고 그대로 던진다.
    throw error
  }

  // 로그인 활동 기록 — 세션 시작 자체를 막지 않는다(activities.ts 모듈 설명,
  // 브리프 필수 조건 1번). 세션은 이미 커밋됐으므로 실패해도 삼키지 않고
  // `onWriteError`로 알린 뒤 sessionId를 그대로 반환한다.
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
    onWriteError?.(error)
  }

  return sessionId
}

/**
 * **`user_id`가 where에 함께 들어가는 이유(교차 사용자 쓰기 차단).**
 *
 * 원본 `manage_user_session` RPC도 `update`/`end`를 `session_token`만으로
 * 매칭했다 — 즉 이건 이식 회귀가 아니라 원본의 결함을 그대로 옮겨온
 * 자리다. 그래도 여기서 좁힌다: 이 브랜치에서 OAuth 경로의 세션 토큰은
 * `session_${user.id}_${Date.now()}` 모양이고 user id는 게시판에 그대로
 * 공개돼 있어 **추측 가능한 토큰 공간**이다. 토큰만으로 매칭하면 아무
 * 로그인 사용자나 남의 세션 `metadata`를 덮어쓰고(`update`), 남의 세션을
 * 강제 종료하며(`end`), 그 결과로 **공격자 user_id + 피해자 session_id**
 * 조합의 logout 행이 활동 피드에 남는다(리뷰어가 파일 DB로 실증).
 *
 * `user_id`를 함께 걸면 남의 세션은 0행 매칭이 되어 `null`을 반환한다 —
 * "매칭되는 활성 세션 없음"과 같은 경로라 정상 동작에는 변화가 없다
 * (자기 세션은 user_id도 당연히 일치한다).
 */
async function updateSession(
  userId: string,
  sessionToken: string,
  metadata: Record<string, unknown>
): Promise<string | null> {
  const [row] = await db
    .update(userSessions)
    .set({ lastActivity: new Date(), metadata })
    .where(
      and(
        eq(userSessions.sessionToken, sessionToken),
        eq(userSessions.userId, userId),
        eq(userSessions.isActive, true)
      )
    )
    .returning({ id: userSessions.id })
  return row?.id ?? null
}

async function endSession(
  input: Required<Omit<ManageSessionInput, 'action'>>,
  onWriteError?: (error: unknown) => void
): Promise<string | null> {
  const [row] = await db
    .update(userSessions)
    .set({ isActive: false, logoutAt: new Date() })
    .where(
      and(
        eq(userSessions.sessionToken, input.session_token),
        // updateSession의 주석 참고 — 토큰만으로 매칭하면 남의 세션을
        // 강제 종료할 수 있다. 자기 세션은 user_id도 일치하므로 정상
        // 경로에는 변화가 없다.
        eq(userSessions.userId, input.user_id),
        eq(userSessions.isActive, true)
      )
    )
    .returning({ id: userSessions.id })
  const sessionId = row?.id ?? null

  // 원본 RPC는 매칭되는 활성 세션이 없어도(session_id가 NULL이어도)
  // 로그아웃 활동을 무조건 기록했다 — 그대로 재현한다. 세션 종료 자체는
  // 이미 끝났으므로(위 UPDATE), 활동 기록 실패는 삼키지 않고 알린 뒤
  // sessionId를 그대로 반환한다. (UPDATE는 user_id를 where에서 읽기만 하고
  // `.set()`으로 쓰지는 않으므로, 여기서는 FK 위반이 나지 않는다 —
  // startSession과 달리 별도 분기가 필요 없다.)
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
    onWriteError?.(error)
  }

  return sessionId
}

/**
 * `manage_user_session` RPC 대체. `p_action`에 따라 세션을 시작/갱신/종료하고
 * (원본과 동일하게) 시작·종료 시 로그인/로그아웃 활동을 기록한다.
 * **세션 쓰기 자체는 성공했는데 활동 기록만 실패한 경우, 이 함수는 그 실패를
 * 삼키지 않고 `onWriteError`로 알리되(호출부가 로그를 남길 수 있게), 세션
 * 작업 결과(반환값)는 그대로 돌려준다** — 활동 기록은 부가 효과이고 세션
 * 시작/종료가 "본 작업"이기 때문이다(브리프 필수 조건 1번, 모듈 설명의
 * "뜨거운 경로" 원칙을 세션에도 적용한 것). `onWriteError`를 생략하면 그
 * 실패는 조용히 버려진다 — 호출부가 로그를 남기고 싶다면 반드시 넘겨야
 * 한다(대부분의 호출부는 넘긴다, 아래 라우트 참고).
 *
 * **`start`에서 프로필이 없는 사용자는 예외다.** 세션 INSERT 자체가 FK
 * 위반으로 실패하는데(모듈 설명의 정정 참고), 이것도 "본 작업을 막지
 * 않는다" 원칙 대상이라 던지지 않고 `onWriteError`로 알린 뒤 `null`을
 * 반환한다 — 세션 핑 API가 그 회원 전체를 500으로 막지 않게 한다(코드리뷰
 * 지적, 새로 생긴 회귀 수정). FK 위반이 아닌 실패(연결 장애 등)는 이 예외
 * 대상이 아니고 그대로 던져진다.
 * @returns 세션 id. `update`/`end`에서 매칭되는 활성 세션이 없거나 `start`가
 * FK 위반(프로필 없음)으로 막히면 `null`.
 * @throws `update`/`end`의 세션 쓰기, 또는 `start`의 FK 위반이 아닌 실패는
 * 그대로 던진다(삼키지 않는다).
 */
export async function manageUserSession(
  input: ManageSessionInput,
  onWriteError?: (error: unknown) => void
): Promise<string | null> {
  const normalized: Required<Omit<ManageSessionInput, 'action'>> = {
    user_id: input.user_id,
    session_token: input.session_token,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    metadata: input.metadata ?? {},
  }

  if (input.action === 'start') return startSession(normalized, onWriteError)
  if (input.action === 'update')
    return updateSession(normalized.user_id, normalized.session_token, normalized.metadata)
  if (input.action === 'end') return endSession(normalized, onWriteError)
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
