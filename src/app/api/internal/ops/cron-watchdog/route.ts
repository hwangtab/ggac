/**
 * 크론 감시자 (Vercel 크론, 매시 35분).
 *
 * 다른 크론의 실행 장부(`work_cron_runs`)를 읽어 ① 'running'으로 방치된 것 ② 마지막 실행이 실패한 것 ③ 마지막 성공이
 * 기대 주기의 2배를 넘긴 것을 찾아 'high' 보안 이벤트로 알린다(`SECURITY_ALERT_WEBHOOK_URL`이 있으면 웹훅).
 *
 * **왜 따로 도는 크론인가**: 전에는 이 감시가 `mention-digest`(업무툴, 매시) 안에서 돌았다. 그 크론이 죽으면 감시도
 * 함께 죽어 아무도 모르는 구조였다 — 2026-11-05 사각지대 점검에서 드러났다. 감시자를 독립 크론으로 빼고, 감시자는
 * **자기 행까지 포함한 전체 표**로 판정한다(시작 기록은 마지막 성공 시각을 건드리지 않으므로, 자기가 오래 못 돌았다면
 * 다시 살아난 첫 실행에서 "내가 N분째 성공하지 않았다"를 스스로 알린다).
 *
 * 감시자가 **아예 다시 살아나지 않는** 경우는 자기가 알 수 없다. 그 구멍은
 * `/api/internal/ops/cron-health`(외부 스케줄이 부른다)가 자기 행까지 보고 503을 내는 것으로 메운다.
 *
 * 문제가 있어도 200을 돌려준다 — 여기서 503을 내면 장부에 '실패'로 남아 같은 사실을 두 번 알리게 된다.
 */
import { isCronAuthorized } from '@work/lib/ops/cron-auth'
import { runCronWatchdog, runTrackedCron } from '@work/lib/ops/cron-alert'
import { listCronRuns } from '@/db/queries/work/cron'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB = 'cron-watchdog'

async function handle(request: Request) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }
  return runTrackedCron(JOB, request, async () => {
    const problems = await runCronWatchdog(new Date())
    return ApiSuccess.ok({ checked: (await listCronRuns()).length, problems }).toNextResponse()
  })
}

export const GET = handle
export const POST = handle
