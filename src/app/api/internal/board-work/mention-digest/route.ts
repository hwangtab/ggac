/**
 * 이사회 업무툴 멘션·DM 메일 다이제스트 (크론 전용, 매시) — 원본 kosmart-work `/api/internal/mention-digest`(10분).
 *
 * 인증은 다른 내부 크론과 같다: `CRON_SECRET` Bearer(타이밍 안전 비교), 없으면 닫는다(`withBoardWorkCron`).
 * 실패(5xx·예외)는 ggac 로거·보안 이벤트로 알린다. 이 크론이 돌 때 다른 업무툴 크론의 감시도 한다.
 * 발송 수단이 없으면(RESEND_API_KEY 없음) 아무것도 하지 않고 skipped로 답한다.
 */
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { withBoardWorkCron } from '@work/lib/ops/cron-alert'
import { digestRunProblem, runMentionDigest } from '@work/lib/digest/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle() {
  const result = await runMentionDigest()
  // 키 오류·실패율 높음은 200으로 묻지 않는다 — 5xx로 돌려 실패 알림이 가게 한다
  const problem = digestRunProblem(result)
  if (problem) {
    console.error('[mention-digest] 부분 실패:', problem, result)
    return ApiError.internalServerError(`다이제스트 실패: ${problem}`).toNextResponse()
  }
  return ApiSuccess.ok(result).toNextResponse()
}

const guarded = withBoardWorkCron('mention-digest', handle)
export const GET = guarded
export const POST = guarded
