/**
 * 크론 감시용 기대 주기 표 — 원본 kosmart-work `lib/ops/cron-schedule.ts`. vercel.json 의 crons 와 같아야 한다
 * (scripts/testing/boardWorkCron.test.mjs 가 어긋나면 실패). 순수 모듈(의존성 없음).
 *
 * ggac 이식: 경로는 `/api/internal/board-work/<이름>`이고, 업무툴 크론 전부(4단계 본문 추출 포함)를 둔다. mention-digest 는 원본 10분 → 매시(설계 §8-5).
 */

/** 업무툴 크론 경로 접두 */
export const BOARD_WORK_CRON_PREFIX = '/api/internal/board-work/'

/** 업무툴 크론 이름(`/api/internal/board-work/<이름>`) → 기대 주기(분) */
export const CRON_EXPECTED_MINUTES: Readonly<Record<string, number>> = {
  'extract-texts': 10,
  'mention-digest': 60,
  'purge-pending-uploads': 1440,
  'purge-deleted': 1440,
  'push-cleanup': 1440,
}

/** 업무툴 밖 크론 경로 접두 — 감시자가 이 접두로도 장부를 본다 */
export const OPS_CRON_PREFIX = '/api/internal/'

/**
 * 업무툴 **밖** 크론 → 기대 주기(분). vercel.json 의 나머지 크론과 같아야 한다
 * (`scripts/testing/boardWorkCron.test.mjs` 가 어긋나면 실패).
 *
 * 왜 여기까지 넣나: 2026-11-05 사각지대 점검 전까지 감시자는 업무툴 5개만 봤다. 문서함 보존(매일 **문서를 지운다**),
 * 지원사업 회차 발행(주 2회 — 놓치면 조합원이 메일을 못 받는다), 회비·티켓·경매 만료가 조용히 멈춰도 아무도 몰랐다.
 * 업무툴 밖 크론은 실행 장부에 자기 이름을 남기고(`withCronLedger`), 감시자가 같은 표로 판정한다.
 *
 * 작업 이름은 경로에서 유추하지 않고 **각 라우트가 정한 이름**을 쓴다(경로가 바뀌어도 장부가 끊기지 않게).
 */
export const OPS_CRON_EXPECTED_MINUTES: Readonly<Record<string, number>> = {
  'uploads-cleanup': 1440,
  'mailbox-backfill': 60,
  'funding-expire': 10,
  'tickets-expire': 10,
  'market-close-auctions': 10,
  'dues-expire': 10,
  'grant-digest-draft': 10080,
  'grant-digest-publish': 10080,
  'member-documents-retention': 1440,
  'cron-watchdog': 60,
}

/** 감시자가 보는 전체 표(업무툴 + 나머지) */
export const ALL_CRON_EXPECTED_MINUTES: Readonly<Record<string, number>> = {
  ...CRON_EXPECTED_MINUTES,
  ...OPS_CRON_EXPECTED_MINUTES,
}

/**
 * 위 작업 이름 → vercel.json 의 경로. 이름과 경로를 따로 두는 이유: 경로가 바뀌어도 장부의 이름은 그대로여야
 * (감시자가 "이 크론이 새 이름이라 기록이 없다"고 오판하지 않는다) 하고, 테스트가 둘의 어긋남을 잡아야 하기 때문이다.
 */
export const OPS_CRON_PATHS: Readonly<Record<string, string>> = {
  'uploads-cleanup': '/api/internal/uploads/cleanup',
  'mailbox-backfill': '/api/internal/mailbox/backfill',
  'funding-expire': '/api/internal/funding/expire',
  'tickets-expire': '/api/internal/tickets/expire',
  'market-close-auctions': '/api/internal/market/close-auctions',
  'dues-expire': '/api/internal/dues/expire',
  'grant-digest-draft': '/api/internal/grant-digest/draft',
  'grant-digest-publish': '/api/internal/grant-digest/publish',
  'member-documents-retention': '/api/internal/member-documents/retention',
  'cron-watchdog': '/api/internal/ops/cron-watchdog',
}

/**
 * 감시자 자신의 작업 이름. 감시자는 **자기를 빼고** 판정한다 — 자기가 방금 시작한 행을 'running 0분'으로 보는 건
 * 의미가 없고, 자기가 죽었는지는 자기가 알 수 없다. 그 구멍은 `/api/internal/ops/cron-health`(외부에서 부른다)가
 * 자기 행까지 포함해 판정하는 것으로 메운다.
 */
export const WATCHDOG_JOB = 'cron-watchdog'
/** 마지막 성공이 기대 주기의 이 배수를 넘으면 "안 돈다" */
export const STALE_FACTOR = 2
/** 'running' 으로 남은 채 이 시간(분)이 지나면 시간 초과로 강제 종료된 것으로 본다(크론 maxDuration 최대 300초 + 여유) */
export const STUCK_MINUTES = 10

/** vercel.json 의 cron 식 → 주기(분). 아는 모양(매 N분 `star/N * * * *`, 매시 `m * * * *`, 매일 `m h * * *`)만, 그 밖은 null */
export function intervalMinutesOf(schedule: string): number | null {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hour, dom, mon, dow] = parts
  if (dom !== '*' || mon !== '*') return null
  const every = /^\*\/(\d+)$/.exec(min)
  if (every && hour === '*' && dow === '*') return Number(every[1])
  if (/^\d+$/.test(min) && hour === '*' && dow === '*') return 60
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dow === '*') return 1440
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^[0-7]$/.test(dow)) return 10080
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
  kind: 'stuck' | 'stale' | 'failed'
  minutes: number
  expected: number
}

/**
 * 실행 장부와 기대 주기를 비교한다. 행이 아직 없는 크론(배포 직후)은 판단하지 않는다.
 *
 * 세 가지를 문제로 본다.
 *  - `stuck`: 'running'으로 남은 채 시간 초과(강제 종료된 흔적).
 *  - `failed`: 마지막 실행이 실패 — 다음 성공이 덮을 때까지 지금 깨져 있다.
 *  - `stale`: 마지막 성공이 기대 주기의 2배를 넘었다(아예 안 돌고 있다).
 *
 * `expected`를 받는 이유: 라우트·테스트가 표를 바꿔 끼워 판정을 확인할 수 있게(기본은 전체 표).
 */
export function findCronProblems(
  rows: readonly CronRunRow[],
  now: Date,
  expected: Readonly<Record<string, number>> = ALL_CRON_EXPECTED_MINUTES
): CronProblem[] {
  const byJob = new Map(rows.map(r => [r.job, r]))
  const problems: CronProblem[] = []
  for (const [job, minutes] of Object.entries(expected)) {
    const row = byJob.get(job)
    if (!row) continue
    const mins = (iso: string | null) => (iso ? (now.getTime() - Date.parse(iso)) / 60_000 : null)
    const sinceStart = mins(row.last_started_at)
    if (row.last_status === 'running' && sinceStart !== null && sinceStart > STUCK_MINUTES) {
      problems.push({ job, kind: 'stuck', minutes: Math.floor(sinceStart), expected: minutes })
      continue
    }
    if (row.last_status === 'failed') {
      problems.push({
        job,
        kind: 'failed',
        minutes: Math.floor(mins(row.last_started_at) ?? 0),
        expected: minutes,
      })
      continue
    }
    const sinceOk = mins(row.last_succeeded_at ?? row.last_started_at)
    if (sinceOk !== null && sinceOk > minutes * STALE_FACTOR) {
      problems.push({ job, kind: 'stale', minutes: Math.floor(sinceOk), expected: minutes })
    }
  }
  return problems
}
