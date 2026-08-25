/**
 * `notifications` 쿼리 계층 (Turso/Drizzle). Task 7(`알림 전환`)이 만든다.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정(로그인 여부,
 * 관리자 여부, 본인 알림만 조작)은 호출부(라우트의 `requireUser()`, admin
 * 프로필 확인)의 몫이고, 이 모듈의 모든 함수는 **이미 검증된 인자만** 받는다.
 *
 * 응답 형태(`NotificationRow`/`NotificationStatsRow`)는 snake_case다 —
 * `src/db/queries/profiles.ts`·`posts.ts`와 같은 이유(CLAUDE.md, strict:
 * false라 키가 바뀌어도 타입 검사가 못 잡고 화면이 조용히 빈다). 필드명은
 * 기존 `Notification`/`NotificationStats`(`src/types/notification.ts`)와
 * 정확히 일치한다.
 *
 * **`markAllNotificationsRead`는 원래 `src/lib/server/notificationsWrite.ts`에
 * 있었다** (단계 2b-5 회귀 수정 — `mark_all_notifications_read()` RPC가
 * `auth.uid()`에 의존하는데, 서비스롤 전환 이후 `auth.uid()`가 항상 NULL이라
 * 항상 0건을 갱신하면서도 200을 응답했다). 그 회귀 수정의 핵심은
 * `.eq('user_id', userId)` — **다른 사용자의 알림을 건드리지 않는 유일한
 * 방어선**이다. 여기서도 그 필터(`eq(notifications.userId, userId)`)와
 * `read_at IS NULL` 조건(`isNull(notifications.readAt)` — 이미 읽은 알림의
 * 시각을 덮어쓰지 않는다)을 반드시 유지한다.
 *
 * **`createBulkNotifications`는 배치 INSERT 한 번이다 — 사용자마다 도는 루프가
 * 아니다.** `db.insert(notifications).values([...])`에 행 배열을 통째로
 * 넘기면 Drizzle이 다중 행 INSERT 한 문장으로 컴파일한다(`scripts/testing/
 * queriesNotifications.test.mjs`의 소스 가드가 `for`/`while` 루프 안에서
 * `db.insert`를 호출하지 않는지 정적으로 확인한다).
 */

import { and, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'

import { db } from '../client.ts'
import { NOTIFICATION_TYPE, notifications } from '../schema/index.ts'

import { toIso } from './_helpers.ts'

export type NotificationTypeValue = (typeof NOTIFICATION_TYPE)[number]

/** API 응답에 쓰이는 snake_case 정규화 형태. `src/types/notification.ts`의
 * `Notification`과 필드명이 정확히 일치한다. */
export interface NotificationRow {
  id: string
  user_id: string
  type: NotificationTypeValue
  title: string
  message: string
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
  expires_at: string | null
  related_post_id: string | null
  related_user_id: string | null
}

function rowToNotification(row: typeof notifications.$inferSelect): NotificationRow {
  return {
    id: row.id,
    user_id: row.userId,
    type: row.type as NotificationTypeValue,
    title: row.title,
    message: row.message,
    data: row.data ?? {},
    read_at: toIso(row.readAt),
    created_at: toIso(row.createdAt) as string,
    expires_at: toIso(row.expiresAt),
    related_post_id: row.relatedPostId,
    related_user_id: row.relatedUserId,
  }
}

// -------------------------------------------------------------------------
// 쓰기 — create_notification / create_bulk_notification RPC 대체
// -------------------------------------------------------------------------

export interface CreateNotificationInput {
  user_id: string
  type: NotificationTypeValue
  title: string
  message: string
  /** 생략하면 `{}`. */
  data?: Record<string, unknown>
  related_post_id?: string | null
  related_user_id?: string | null
  /** ISO 문자열 또는 `null`(생략도 `null`과 동일). */
  expires_at?: string | null
}

/**
 * 알림 하나를 생성한다. `create_notification` RPC 대체 — 원본은
 * `auth.uid()` 기반 권한 분기(관리자/트리거/그 외)를 가졌지만, 서비스롤
 * 전환 후 그 분기는 항상 통과 상태였다(브리프 명시). 실제 권한 검사는
 * 호출부(`/api/notifications` POST의 admin 프로필 확인)가 한다.
 * @returns 새로 생성된 알림의 id(원본 RPC가 `RETURNING id`로 돌려주던 uuid와
 * 동일한 모양).
 * @throws DB 쓰기가 실패하면 그대로 던진다(삼키지 않는다).
 */
export async function createNotification(input: CreateNotificationInput): Promise<string> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: input.user_id,
      type: input.type,
      title: input.title,
      message: input.message,
      data: input.data ?? {},
      relatedPostId: input.related_post_id ?? null,
      relatedUserId: input.related_user_id ?? null,
      expiresAt: input.expires_at ? new Date(input.expires_at) : null,
    })
    .returning({ id: notifications.id })
  return row.id
}

export interface CreateBulkNotificationsInput {
  user_ids: string[]
  type: NotificationTypeValue
  title: string
  message: string
  data?: Record<string, unknown>
  expires_at?: string | null
  /** 모든 수신자에게 공통으로 붙는 연관 게시글/사용자 id. 생략하면 `null`.
   * 원본 `create_bulk_notification` RPC에는 없던 인자다 — `notify_new_post()`
   * 트리거는 이 값을 담으려고 대신 `create_notification`을 회원마다 호출하는
   * 루프를 썼다(공지 알림 배치 전환, 아래 참고). */
  related_post_id?: string | null
  related_user_id?: string | null
}

/**
 * 여러 사용자에게 같은 알림을 생성한다. `create_bulk_notification` RPC
 * 대체 — **반드시 배치 INSERT 한 번**이어야 한다(모듈 설명 참고). `user_ids`가
 * 비면 쿼리를 실행하지 않고 0을 돌려준다(원본 RPC의 `unnest('{}'::uuid[])`가
 * 빈 집합에 대해 0건을 삽입하는 것과 동일한 결과).
 * @returns 삽입된 행 수(원본 RPC의 `RETURN inserted_count`와 동일).
 * @throws DB 쓰기가 실패하면 그대로 던진다(삼키지 않는다).
 */
export async function createBulkNotifications(
  input: CreateBulkNotificationsInput
): Promise<number> {
  if (input.user_ids.length === 0) return 0

  const expiresAt = input.expires_at ? new Date(input.expires_at) : null
  const relatedPostId = input.related_post_id ?? null
  const relatedUserId = input.related_user_id ?? null
  const rows = await db
    .insert(notifications)
    .values(
      input.user_ids.map(userId => ({
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        data: input.data ?? {},
        expiresAt,
        relatedPostId,
        relatedUserId,
      }))
    )
    .returning({ id: notifications.id })
  return rows.length
}

// -------------------------------------------------------------------------
// 읽기 — 목록 + 통계
// -------------------------------------------------------------------------

export interface ListNotificationsFilter {
  type?: NotificationTypeValue | null
  unreadOnly?: boolean
  /** 1부터. */
  page: number
  limit: number
}

/**
 * 로그인한 사용자의 알림 목록. 기존 `/api/notifications` GET의 수동 Supabase
 * 쿼리(`.eq('user_id', ...).order('created_at', {ascending:false})` +
 * 필터 + `.range()`) 대체. `total`은 **같은 필터가 적용된 별도 COUNT
 * 쿼리**로 구한다(posts.ts의 `count(*) over()` 윈도 방식과 달리, 마지막
 * 페이지를 넘겨 요청해 이 페이지에 행이 0개가 되어도 `total`이 0으로
 * 떨어지지 않는다 — 알림 페이지네이션 UI가 `total_pages`를 실제로
 * 표시하므로 그 경계를 피했다). `unreadCount`는 `type`/`unread_only` 필터와
 * 무관하게 항상 "이 사용자의 안 읽은 알림 수" 하나를 구한다(기존 라우트의
 * 별도 `unreadCount` 쿼리와 동일 스코프).
 */
export async function listNotifications(
  userId: string,
  filter: ListNotificationsFilter
): Promise<{ rows: NotificationRow[]; total: number; unreadCount: number }> {
  const conditions: SQL[] = [eq(notifications.userId, userId)]
  if (filter.type) {
    conditions.push(eq(notifications.type, filter.type))
  }
  if (filter.unreadOnly) {
    conditions.push(isNull(notifications.readAt))
  }
  const where = and(...conditions) as SQL

  const offset = Math.max(0, (filter.page - 1) * filter.limit)

  const [rows, totalRows, unreadRows] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(filter.limit)
      .offset(offset),
    db.select({ value: count() }).from(notifications).where(where),
    db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ])

  return {
    rows: rows.map(rowToNotification),
    total: totalRows[0]?.value ?? 0,
    unreadCount: unreadRows[0]?.value ?? 0,
  }
}

/** API 응답에 쓰이는 snake_case 정규화 형태. `notification_stats` 뷰와 필드명이
 * 정확히 일치한다(`src/types/notification.ts`의 `NotificationStats`와 동일). */
export interface NotificationStatsRow {
  user_id: string
  total_notifications: number
  unread_count: number
  read_count: number
  latest_notification_at: string | null
}

/**
 * `notification_stats` 뷰 대체. 원본 정의:
 * ```sql
 * SELECT user_id, count(*) AS total_notifications,
 *        count(*) FILTER (WHERE read_at IS NULL)     AS unread_count,
 *        count(*) FILTER (WHERE read_at IS NOT NULL) AS read_count,
 *        max(created_at) AS latest_notification_at
 * FROM notifications GROUP BY user_id;
 * ```
 * SQLite에는 `FILTER`가 없어 `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`으로
 * 옮긴다. 원본은 `GROUP BY user_id`라 알림이 하나도 없는 사용자는 결과
 * 행 자체가 없다(`/api/notifications/stats`가 그 경우 `PGRST116`을 감지해
 * 0으로 채운 기본값을 대신 응답했다) — 이 함수는 `GROUP BY` 없이
 * `WHERE user_id = ?` 하나로 집계해 **행이 없을 때도 항상 0으로 채운
 * 객체를 돌려준다**. 최종 API 응답은 두 경로 모두 동일하다(0으로 채운
 * 통계) — 호출부가 "없으면 기본값" 분기를 따로 둘 필요가 없어졌을 뿐,
 * 응답 스키마는 바뀌지 않는다.
 */
export async function getNotificationStats(userId: string): Promise<NotificationStatsRow> {
  const [row] = await db
    .select({
      total: count(),
      unread: sql<number>`coalesce(sum(case when ${notifications.readAt} is null then 1 else 0 end), 0)`,
      read: sql<number>`coalesce(sum(case when ${notifications.readAt} is not null then 1 else 0 end), 0)`,
      latest: sql<number | null>`max(${notifications.createdAt})`,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))

  return {
    user_id: userId,
    total_notifications: Number(row?.total ?? 0),
    unread_count: Number(row?.unread ?? 0),
    read_count: Number(row?.read ?? 0),
    latest_notification_at:
      row?.latest !== null && row?.latest !== undefined
        ? new Date(Number(row.latest)).toISOString()
        : null,
  }
}

// -------------------------------------------------------------------------
// 쓰기 — 읽음 처리 / 삭제
// -------------------------------------------------------------------------

/**
 * 알림 하나를 읽음 처리한다. 기존 `/api/notifications/[id]` PATCH의 수동
 * Supabase 업데이트(`.eq('id', notificationId).eq('user_id', user.id)
 * .is('read_at', null)`) 대체 — **소유권 필터(`user_id`)와 `read_at IS
 * NULL` 조건을 그대로 유지한다.** 후자가 없으면 이미 읽은 알림의 `read_at`이
 * (같은 값이라도) 매 호출마다 재기록될 수 있다는 것보다 더 중요한 이유가
 * 있다 — 이 조건 자체가 "이미 읽은 행은 대상에서 제외"라는 원본 RPC의
 * 불변식이다.
 * @returns 갱신된 행(없으면, 즉 존재하지 않거나 남의 알림이거나 이미 읽은
 * 알림이면 `null`). DB 오류는 그대로 throw한다.
 */
export async function markNotificationRead(
  id: string,
  userId: string
): Promise<NotificationRow | null> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt))
    )
    .returning()
  return row ? rowToNotification(row) : null
}

/**
 * 알림 하나를 삭제한다(본인 알림만). 기존 `/api/notifications/[id]` DELETE의
 * `.delete().eq('id', notificationId).eq('user_id', user.id)` 대체 — 원본과
 * 동일하게 대상 행이 없어도(이미 삭제됐거나 남의 알림이거나) 에러를 내지
 * 않고 조용히 0건 삭제로 끝난다(원본도 삭제된 행 수를 확인하지 않았다).
 */
export async function deleteNotification(id: string, userId: string): Promise<void> {
  await db
    .delete(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
}

/**
 * 로그인한 사용자의 안 읽은 알림을 모두 읽음 처리한다.
 *
 * 원래는 `mark_all_notifications_read()` RPC였고, 그 후 단계 2b-5 회귀
 * 수정으로 `src/lib/server/notificationsWrite.ts`의 앱 계층 직접 UPDATE로
 * 옮겨졌다(RPC의 `auth.uid()` 의존이 서비스롤 전환 후 항상 NULL이 되어
 * 항상 0건을 갱신하며 200을 응답하던 회귀). 이 함수가 그 구현을 그대로
 * 계승한다 — **`.eq('user_id', userId)`(다른 사용자의 알림을 건드리지 않는
 * 유일한 방어선)와 `read_at IS NULL`(이미 읽은 알림은 건드리지 않는다)
 * 둘 다 반드시 유지한다.**
 * @returns 갱신된 행 수.
 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id })
  return rows.length
}
