/**
 * 조합원 내 문서함 보존 정리 (크론 전용, 매일) — docs/board-work/04-조합원-문서함.md §6.
 *
 * 1년 동안 열지 않은 문서는 주인에게 알리고(알림 + 메일), 알린 지 30일이 지나도 열지 않으면 지운다. 24시간이 지난
 * 임시 업로드도 치운다. 판정은 `src/lib/memberDocuments/rules.ts`(`retentionActionOf`)와 같은 조건의 쿼리가 한다.
 *
 * 인증은 다른 내부 크론과 같다: `Authorization: Bearer $CRON_SECRET` 타이밍 안전 비교(`isCronAuthorized`), 시크릿이
 * 없으면 닫는다(401). 기능 스위치와 무관하게 돈다 — 스위치를 꺼 둔 동안에도 보존 기한은 흐르고, 꺼졌다고 문서가 영원히
 * 남으면 안 된다(켜진 적이 없으면 표가 비어 있어 아무것도 하지 않는다).
 *
 * **장부·경보(2026-11-05 사각지대 점검)**: 이 크론은 없던 동안 아무 흔적도 남기지 않았다 — 매일 개인 문서를 지우는
 * 작업인데 돌았는지·실패했는지 확인할 길이 없었고(Vercel 로그 보존 1일), 감시자의 표에도 없었다. 이제
 * `withCronLedger`와 같은 장부(`work_cron_runs`)에 남아 `cron-watchdog`이 함께 보고, 한 번에 지운 문서가 임계를
 * 넘으면 'high'로 알린다(되돌릴 수 없는 작업이라 조용히 대량 삭제가 일어나면 안 된다).
 */
import { isCronAuthorized } from '@work/lib/ops/cron-auth'
import { runTrackedCron } from '@work/lib/ops/cron-alert'
import { runMemberDocumentRetention } from '@/lib/memberDocuments/retention'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/internal/member-documents/retention')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 한 번에 이만큼 넘게 지워지면 알린다. 정상 운영에서 하루치는 몇 건이다(1년 미열람 → 30일 전 고지 → 삭제 조건이
 * 계속 참인 문서만). 삭제 배치 상한이 100이므로, 조건 판정이 어긋나 대량 삭제가 시작되면 여기서 먼저 보인다.
 */
const MASS_DELETE_ALERT_THRESHOLD = 10

/** 인증을 통과한 호출만 장부에 남긴다(401은 장부를 오염시키지 않는다). */
async function handle(request: Request) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return ApiError.unauthorized('권한이 없습니다.').toNextResponse()
  }
  return runTrackedCron('member-documents-retention', request, () => run())
}

async function run() {
  try {
    const result = await runMemberDocumentRetention(new Date())
    if (result.deletedDocuments >= MASS_DELETE_ALERT_THRESHOLD) {
      logSecurityEvent(
        'MEMBER_DOCUMENTS_MASS_DELETE',
        {
          deletedDocuments: result.deletedDocuments,
          deferredDocuments: result.deferredDocuments,
          purgedUploads: result.purgedUploads,
          orphansRemoved: result.orphansRemoved,
        },
        'high'
      )
    }
    return ApiSuccess.ok(result).toNextResponse()
  } catch (e) {
    log.error('보존 정리 실패', { error: e instanceof Error ? e.name : typeof e })
    return ApiError.internalServerError('문서함 보존 정리에 실패했습니다.').toNextResponse()
  }
}

export const GET = handle
export const POST = handle
