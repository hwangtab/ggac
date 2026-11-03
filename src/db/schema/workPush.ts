// src/db/schema/workPush.ts
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, nowMs, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

/**
 * 이사회 업무툴 5단계 — 웹 푸시 구독·메일 다이제스트 상태·크론 실행 장부(docs/board-work/01-설계.md §4·§8-4·§8-5).
 * 원본은 kosmart-work `work.push_subscriptions`(0001·0008·0033), `work.digest_state`(0005), `work.cron_runs`(0042)다.
 *
 * 1단계와 같은 규칙으로 옮겼다: `work_` 접두사, 사람 FK는 `member_profiles`, CHECK 없음. 원본의
 * harden_push_subscriptions_write(user_id 강제)와 0033의 "authenticated INSERT·UPDATE 회수"는 옮겨지지 않았다 —
 * 구독 쓰기는 `/api/board-room/work/push/*` 라우트만 하고, 쓰기 함수(`src/db/queries/work/push.ts`)는 user_id를
 * 인자로만 받는다. 이 DDL만 보고 "막혀 있다"고 믿지 말 것.
 */

/** 기기별 웹 푸시 구독(원본 push_subscriptions). endpoint가 유일하다 — 같은 브라우저 구독은 한 사람 것이다 */
export const workPushSubscriptions = sqliteTable(
  'work_push_subscriptions',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => memberProfiles.id, { onDelete: 'cascade' }),
    /** 푸시 서비스 주소. 서버가 여기로 POST하므로 저장 전·발송 직전에 허용 목록·SSRF 검사를 한다 */
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    /** 마지막으로 구독을 다시 알렸거나 발송에 성공한 때. 90일 넘으면 정리 크론이 지운다 */
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowMs())
      .$defaultFn(() => new Date()),
  },
  table => [
    uniqueIndex('work_push_subscriptions_endpoint_key').on(table.endpoint),
    index('work_push_subscriptions_user_idx').on(table.userId),
    index('work_push_subscriptions_last_seen_idx').on(table.lastSeenAt),
  ]
)

/**
 * 사용자별 마지막 다이제스트 발송 기준(원본 digest_state). `last_sent_at`은 **보낸 메일에 담긴 메시지 중 가장 늦은
 * created_at**이다(지금 시각이 아니다 — 컷오프 직후 도착분이 빠지지 않게).
 */
export const workDigestState = sqliteTable('work_digest_state', {
  userId: text('user_id')
    .primaryKey()
    .references(() => memberProfiles.id, { onDelete: 'cascade' }),
  lastSentAt: integer('last_sent_at', { mode: 'timestamp_ms' }).notNull(),
})

/**
 * 크론 실행 장부(원본 cron_runs, 0042) — 크론 이름이 PK(행 4개 안팎). 시작 때 'running', 끝나면 'ok'·'failed'.
 * 시간 초과로 함수가 죽으면 'running'이 남아 감시(mention-digest가 돌 때)가 잡는다.
 */
export const workCronRuns = sqliteTable('work_cron_runs', {
  job: text('job').primaryKey(),
  lastStartedAt: integer('last_started_at', { mode: 'timestamp_ms' }),
  lastSucceededAt: integer('last_succeeded_at', { mode: 'timestamp_ms' }),
  /** 'running' | 'ok' | 'failed' */
  lastStatus: text('last_status').notNull().default('running'),
})
