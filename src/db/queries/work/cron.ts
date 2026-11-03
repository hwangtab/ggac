/**
 * 업무툴 크론 실행 장부(`work_cron_runs`) — 원본 kosmart-work `lib/ops/cron-runs.ts`·`cron-watchdog.ts`의 DB 부분(0042).
 * 권한을 모른다(크론 라우트가 CRON_SECRET을 먼저 본다).
 */
import { eq } from 'drizzle-orm'

import { db } from '../../client.ts'
import { workCronRuns } from '../../schema/index.ts'

export type CronRunRecord = {
  job: string
  last_started_at: string | null
  last_succeeded_at: string | null
  last_status: string
}

/** 시작: 'running'으로 남긴다(행이 없으면 만든다) */
export async function markCronStarted(job: string, now: Date = new Date()): Promise<void> {
  await db
    .insert(workCronRuns)
    .values({ job, lastStartedAt: now, lastStatus: 'running' })
    .onConflictDoUpdate({
      target: workCronRuns.job,
      set: { lastStartedAt: now, lastStatus: 'running' },
    })
}

/** 끝: 성공이면 'ok' + 성공 시각, 실패면 'failed' */
export async function markCronFinished(
  job: string,
  ok: boolean,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(workCronRuns)
    .set(ok ? { lastStatus: 'ok', lastSucceededAt: now } : { lastStatus: 'failed' })
    .where(eq(workCronRuns.job, job))
}

export async function listCronRuns(): Promise<CronRunRecord[]> {
  const rows = await db.select().from(workCronRuns)
  return rows.map(r => ({
    job: r.job,
    last_started_at: r.lastStartedAt ? r.lastStartedAt.toISOString() : null,
    last_succeeded_at: r.lastSucceededAt ? r.lastSucceededAt.toISOString() : null,
    last_status: r.lastStatus,
  }))
}
