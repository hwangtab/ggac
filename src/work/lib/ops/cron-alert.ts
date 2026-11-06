import { ApiError } from '@/utils/apiWrapper'
import { listCronRuns, markCronFinished, markCronStarted } from '@/db/queries/work/cron'
import { alertOpsAdmins, type OpsAlertInput } from '@/lib/server/opsAlert'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'
import { isCronAuthorized, isCronSecretConfigured } from './cron-auth'
import { findCronProblems, type CronProblem } from './cron-schedule'

const log = createLogger('board-work/cron')

/**
 * 업무툴 크론 라우트 감싸기 — 원본 kosmart-work `lib/ops/cron-alert.ts`(withCronAlert)·`cron-runs.ts`·`cron-watchdog.ts`.
 *
 * 1. **인증이 먼저다**: `Authorization: Bearer $CRON_SECRET`(타이밍 안전 비교). 틀리거나 시크릿이 없으면 401 — 핸들러를
 *    부르지 않는다. 시크릿이 아예 없으면(설정 사라짐 — 모든 크론이 조용히 멈춘다) 실패 알림도 남긴다.
 * 2. 실행 장부(`work_cron_runs`): 인증된 GET(Vercel 크론)만 시작·끝을 남긴다. 손으로 부른 POST는 크론 성공을 가리지 않게
 *    세지 않는다.
 * 3. 실패(5xx·예외) 알림: 원본은 운영 채널(ops-system)에 봇 글 + owner 웹 푸시를 보냈다. ggac에는 그 채널이 없어
 *    **ggac 로거 + 보안 이벤트('high')**로 내보낸다(Vercel 런타임 로그 + `SECURITY_ALERT_WEBHOOK_URL`이 있으면 웹훅).
 *    오류 내용은 담지 않는다(크론 이름·상태 코드만).
 * 4. 감시: 크론 감시자는 **따로 도는 크론**(`/api/internal/ops/cron-watchdog`)이다. 다른 크론의 마지막 성공이 기대
 *    주기의 2배를 넘었거나 'running'으로 방치됐는지 본다(원본 cron-watchdog). 감시자를 mention-digest 안에 두면
 *    그 크론이 죽는 순간 감시도 같이 죽어 아무도 모른다 — 2026-11-05 사각지대 점검에서 드러난 구멍이다.
 * 장부·알림 실패는 절대 크론 응답을 바꾸지 않는다(로그만).
 */
export function withBoardWorkCron(
  job: string,
  handler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async request => {
    const secret = process.env.CRON_SECRET
    if (!isCronAuthorized(request.headers.get('authorization'), secret)) {
      if (!isCronSecretConfigured(secret)) {
        log.error(`CRON_SECRET 미설정 — ${job} 요청을 거부합니다`)
        alertFailure(job, 503)
      }
      return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
    }

    return trackCronRun(job, request, () => handler(request))
  }
}

/**
 * 업무툴 **밖** 크론(회비·티켓·경매·지원사업·메일함·문서함)에 실행 장부와 실패 알림만 붙인다.
 *
 * 인증은 각 라우트가 그대로 갖는다 — 이 크론들은 토큰이 제각각(`PAYMENTS_CRON_TOKEN`·`GRANT_DIGEST_CRON_TOKEN`·
 * `CLEANUP_CRON_TOKEN`·`CRON_SECRET`)이라 감싸개가 대신 판정할 수 없다. 그래서 라우트가 **인증을 통과한 뒤** 자기
 * 본문을 이 함수에 넘긴다(401은 장부에 남기지 않는다 — 스캐너가 두드린 것으로 크론 실패를 오염시키지 않게).
 *
 * 장부 규칙은 업무툴과 같다: Vercel 크론이 보내는 GET만 성공·실패를 세고, 손으로 부른 POST는 세지 않는다.
 *
 * 2026-11-05 사각지대 점검: 이 크론들은 **아무 장부도 남기지 않아** 멈춰도 알 방법이 없었다(특히 문서함 보존은
 * 매일 개인 문서를 지운다). 이 감싸개를 씌우면 `cron-watchdog`이 같은 표로 함께 본다.
 */
export function runTrackedCron(
  job: string,
  request: Request,
  run: () => Promise<Response>
): Promise<Response> {
  return trackCronRun(job, request, run)
}

async function trackCronRun(
  job: string,
  request: Request,
  run: () => Promise<Response>
): Promise<Response> {
  const tracked = request.method === 'GET'
  if (tracked) {
    await markCronStarted(job).catch(e => log.error('실행 장부 시작 기록 실패', e))
  }
  let response: Response
  try {
    response = await run()
  } catch (err) {
    log.error(`[${job}] 처리되지 않은 오류`, err)
    response = ApiError.internalServerError('크론 실행에 실패했습니다.').toNextResponse()
  }
  if (tracked) {
    await markCronFinished(job, response.status < 400).catch(e =>
      log.error('실행 장부 종료 기록 실패', e)
    )
  }
  if (response.status >= 500) alertFailure(job, response.status)
  return response
}

function alertFailure(job: string, status: number): void {
  try {
    log.error(`${job} 크론 실패 (HTTP ${status}). Vercel 로그에서 [${job}]를 확인하세요.`)
    logSecurityEvent('BOARD_WORK_CRON_FAILED', { job, status }, 'high')
  } catch {
    // 알림 실패가 응답을 막지 않는다
  }
}

/**
 * 다른 크론이 안 돌거나·끊겼거나·마지막 실행이 실패했는지 본다. 알린 건수.
 *
 * 자기를 포함한 **전체 표**로 판정한다 — 시작 기록(`markCronStarted`)은 `last_succeeded_at`을 건드리지 않으므로,
 * 감시자가 오래 못 돌았다면 자기 행이 그대로 '지연'으로 잡힌다. 즉 감시자가 죽었다가 다시 살아나면 첫 실행에서
 * "내가 2시간 넘게 안 돌았다"를 스스로 알린다. 아예 다시 살아나지 않는 경우는 외부 점검
 * (`/api/internal/ops/cron-health`)이 맡는다.
 */
export async function runCronWatchdog(now: Date = new Date()): Promise<number> {
  try {
    const problems = findCronProblems(await listCronRuns(), now)
    for (const p of problems) {
      log.error(
        p.kind === 'stuck'
          ? `${p.job} 크론이 ${p.minutes}분째 끝나지 않았습니다(시간 초과로 강제 종료된 것으로 보임)`
          : p.kind === 'failed'
            ? `${p.job} 크론의 마지막 실행이 실패했습니다`
            : `${p.job} 크론이 ${p.minutes}분째 성공하지 않았습니다(기대 주기 ${p.expected}분)`
      )
      logSecurityEvent(
        'BOARD_WORK_CRON_STALLED',
        { job: p.job, kind: p.kind, minutes: p.minutes, expected: p.expected },
        'high'
      )
    }
    if (problems.length > 0) await alertOpsAdmins(buildCronAlert(problems))
    return problems.length
  } catch (err) {
    log.error('크론 감시 실패', err)
    return 0
  }
}

/**
 * 크론 문제 묶음을 관리자 경보 한 건으로 — 문제마다 메일을 보내면 하루에 스무 통이 온다.
 * 감시자는 매시 돌므로 같은 사실을 6시간에 한 번까지만 다시 알린다(dedupe).
 */
function buildCronAlert(problems: CronProblem[]): OpsAlertInput {
  const lines = problems
    .slice(0, 8)
    .map(p =>
      p.kind === 'stuck'
        ? `· ${p.job} — ${p.minutes}분째 끝나지 않음(강제 종료 추정)`
        : p.kind === 'failed'
          ? `· ${p.job} — 마지막 실행 실패`
          : `· ${p.job} — ${p.minutes}분째 성공 없음(기대 ${p.expected}분)`
    )
  const more = problems.length > lines.length ? `\n· 외 ${problems.length - lines.length}건` : ''
  return {
    kind: 'ops_cron_problems',
    title: `크론 ${problems.length}건이 멈췄거나 실패했습니다`,
    message:
      `${lines.join('\n')}${more}\n\n` +
      '크론이 멈추면 그 크론이 하던 일이 조용히 사라집니다(문서 보존 삭제·지원사업 메일 발행·회비 만료·경매 마감 등). ' +
      'Vercel 대시보드의 Cron 로그와 이 목록의 이름으로 원인을 확인해 주세요.',
    url: '/ko/admin',
    data: { count: problems.length, jobs: problems.map(p => p.job) },
    dedupe: true,
  }
}
