/**
 * 크론 건강 점검 (읽기 전용, 외부 스케줄 전용).
 *
 * `cron-watchdog`은 자기가 죽으면 자기가 알릴 수 없다. 이 라우트는 **감시자 자신의 행까지 포함한** 전체 표로 같은
 * 판정을 하고, 문제가 있으면 **503**을 낸다 — GitHub Actions(`.github/workflows/uptime-check.yml`)가 이 상태 코드를
 * 보고 실패하면 저장소 소유자에게 메일이 간다. 즉 감시자가 통째로 멈춘 경우의 마지막 그물이다.
 *
 * 장부에 남기지 않는다(감시 대상이 아니라 관측 창구다). 알림도 직접 쏘지 않는다 — 감시자가 살아 있으면 감시자가 이미
 * 같은 사실을 웹훅으로 보냈고, 여기서 또 보내면 같은 장애를 두 번 알린다.
 *
 * 응답: `{ success: true, data: { ok, problems, checkedAt } }`, 문제가 있으면 503 + `{ success:false, ... }`.
 */
import { NextResponse } from 'next/server'

import { isCronAuthorized } from '@work/lib/ops/cron-auth'
import { listCronRuns } from '@/db/queries/work/cron'
import { findCronProblems, WATCHDOG_JOB } from '@work/lib/ops/cron-schedule'
import { alertOpsAdmins } from '@/lib/server/opsAlert'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { logSecurityEvent } from '@/utils/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function handle(request: Request) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }

  const now = new Date()
  const rows = await listCronRuns()
  const problems = findCronProblems(rows, now)
  const data = {
    ok: problems.length === 0,
    checkedAt: now.toISOString(),
    jobs: rows.length,
    problems,
  }

  // 감시자 자신이 멈춘 경우는 **여기서만** 알 수 있다(자기는 자기를 못 본다). 이 라우트는 외부 스케줄이 부르므로,
  // 그때만 관리자에게 알린다. 나머지 문제는 감시자가 이미 알렸으니 두 번 알리지 않는다.
  const watchdogDown = problems.filter(p => p.job === WATCHDOG_JOB)
  if (watchdogDown.length > 0) {
    logSecurityEvent(
      'CRON_WATCHDOG_DOWN',
      { kind: watchdogDown[0].kind, minutes: watchdogDown[0].minutes },
      'high'
    )
    await alertOpsAdmins({
      kind: 'ops_cron_watchdog_down',
      title: '크론 감시자가 멈췄습니다',
      message:
        `${watchdogDown[0].minutes}분째 크론 감시자(cron-watchdog)가 성공하지 않았습니다. ` +
        '감시자가 멈추면 다른 크론이 멈춰도 아무도 알 수 없습니다. Vercel 대시보드의 Cron 로그에서 ' +
        '/api/internal/ops/cron-watchdog 실행 기록을 확인해 주세요.',
      url: '/ko/admin',
      data: { minutes: watchdogDown[0].minutes, kind: watchdogDown[0].kind },
      dedupe: true,
    })
  }

  if (problems.length === 0) return ApiSuccess.ok(data).toNextResponse()

  // 503 + 본문 — 외부 스케줄이 상태 코드로 실패를 감지하고, 사람은 본문에서 어느 크론인지 본다.
  return NextResponse.json(
    { success: false, message: '크론 이상이 감지되었습니다.', data },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  )
}

export const GET = handle
