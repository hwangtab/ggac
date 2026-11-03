/**
 * 크론 감시용 기대 주기 표 — 원본 kosmart-work `lib/ops/cron-schedule.ts`. vercel.json 의 crons 와 같아야 한다
 * (scripts/testing/boardWorkCron.test.mjs 가 어긋나면 실패). 순수 모듈(의존성 없음).
 *
 * ggac 이식: 경로는 `/api/internal/board-work/<이름>`이고, 이 단계(5)가 등록한 크론만 둔다. 본문 추출(extract-texts)은
 * 4단계가 자기 크론과 함께 이 표에 더한다. mention-digest 는 원본 10분 → 매시(설계 §8-5).
 */

/** 업무툴 크론 경로 접두 */
export const BOARD_WORK_CRON_PREFIX = '/api/internal/board-work/'

/** 크론 이름(`/api/internal/board-work/<이름>`) → 기대 주기(분) */
export const CRON_EXPECTED_MINUTES: Readonly<Record<string, number>> = {
  'mention-digest': 60,
  'purge-pending-uploads': 1440,
  'purge-deleted': 1440,
  'push-cleanup': 1440,
}

/** 다른 크론을 감시하는 크론(가장 짧은 주기) */
export const WATCHDOG_JOB = 'mention-digest'
/** 마지막 성공이 기대 주기의 이 배수를 넘으면 "안 돈다" */
export const STALE_FACTOR = 2
/** 'running' 으로 남은 채 이 시간(분)이 지나면 시간 초과로 강제 종료된 것으로 본다(크론 maxDuration 최대 300초 + 여유) */
export const STUCK_MINUTES = 10

/** vercel.json 의 cron 식 → 주기(분). 아는 모양(매 N분 `star/N * * * *`, 매시 `m * * * *`, 매일 `m h * * *`)만, 그 밖은 null */
export function intervalMinutesOf(schedule: string): number | null {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hour, dom, mon, dow] = parts
  if (dom !== '*' || mon !== '*' || dow !== '*') return null
  const every = /^\*\/(\d+)$/.exec(min)
  if (every && hour === '*') return Number(every[1])
  if (/^\d+$/.test(min) && hour === '*') return 60
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) return 1440
  return null
}

export type CronRunRow = {
  job: string
  last_started_at: string | null
  last_succeeded_at: string | null
  last_status: string
}

export type CronProblem = {
  job: string
  kind: 'stuck' | 'stale'
  minutes: number
  expected: number
}

/** 실행 장부와 기대 주기를 비교한다. 행이 아직 없는 크론(배포 직후)은 판단하지 않는다. */
export function findCronProblems(rows: readonly CronRunRow[], now: Date): CronProblem[] {
  const byJob = new Map(rows.map(r => [r.job, r]))
  const problems: CronProblem[] = []
  for (const [job, expected] of Object.entries(CRON_EXPECTED_MINUTES)) {
    if (job === WATCHDOG_JOB) continue
    const row = byJob.get(job)
    if (!row) continue
    const mins = (iso: string | null) => (iso ? (now.getTime() - Date.parse(iso)) / 60_000 : null)
    const sinceStart = mins(row.last_started_at)
    if (row.last_status === 'running' && sinceStart !== null && sinceStart > STUCK_MINUTES) {
      problems.push({ job, kind: 'stuck', minutes: Math.floor(sinceStart), expected })
      continue
    }
    const sinceOk = mins(row.last_succeeded_at ?? row.last_started_at)
    if (sinceOk !== null && sinceOk > expected * STALE_FACTOR) {
      problems.push({ job, kind: 'stale', minutes: Math.floor(sinceOk), expected })
    }
  }
  return problems
}
