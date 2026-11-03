import { ApiError } from '@/utils/apiWrapper'
import { listCronRuns, markCronFinished, markCronStarted } from '@/db/queries/work/cron'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'
import { isCronAuthorized, isCronSecretConfigured } from './cron-auth'
import { WATCHDOG_JOB, findCronProblems } from './cron-schedule'

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
 * 4. 감시: WATCHDOG_JOB(mention-digest)이 돌 때 다른 크론의 마지막 성공이 기대 주기의 2배를 넘었거나 'running'으로
 *    방치됐는지 본다(원본 cron-watchdog).
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

    const tracked = request.method === 'GET'
    if (tracked) {
      await markCronStarted(job).catch(e => log.error('실행 장부 시작 기록 실패', e))
    }
    let response: Response
    try {
      response = await handler(request)
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
    if (tracked && job === WATCHDOG_JOB) await runCronWatchdog()
    return response
  }
}

function alertFailure(job: string, status: number): void {
  try {
    log.error(`${job} 크론 실패 (HTTP ${status}). Vercel 로그에서 [${job}]를 확인하세요.`)
    logSecurityEvent('BOARD_WORK_CRON_FAILED', { job, status }, 'high')
  } catch {
    // 알림 실패가 응답을 막지 않는다
  }
}

/** 다른 크론이 안 돌거나 끊겼는지 본다. 알린 건수 */
export async function runCronWatchdog(now: Date = new Date()): Promise<number> {
  try {
    const problems = findCronProblems(await listCronRuns(), now)
    for (const p of problems) {
      log.error(
        p.kind === 'stuck'
          ? `${p.job} 크론이 ${p.minutes}분째 끝나지 않았습니다(시간 초과로 강제 종료된 것으로 보임)`
          : `${p.job} 크론이 ${p.minutes}분째 성공하지 않았습니다(기대 주기 ${p.expected}분)`
      )
      logSecurityEvent(
        'BOARD_WORK_CRON_STALLED',
        { job: p.job, kind: p.kind, minutes: p.minutes, expected: p.expected },
        'high'
      )
    }
    return problems.length
  } catch (err) {
    log.error('크론 감시 실패', err)
    return 0
  }
}
