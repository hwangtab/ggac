/**
 * 조합원 내 문서함 보존 정리 (크론 전용, 매일) — docs/board-work/04-조합원-문서함.md §6.
 *
 * 1년 동안 열지 않은 문서는 주인에게 알리고(알림 + 메일), 알린 지 30일이 지나도 열지 않으면 지운다. 24시간이 지난
 * 임시 업로드도 치운다. 판정은 `src/lib/memberDocuments/rules.ts`(`retentionActionOf`)와 같은 조건의 쿼리가 한다.
 *
 * 인증은 다른 내부 크론과 같다: `Authorization: Bearer $CRON_SECRET` 타이밍 안전 비교(`isCronAuthorized`), 시크릿이
 * 없으면 닫는다(401). 기능 스위치와 무관하게 돈다 — 스위치를 꺼 둔 동안에도 보존 기한은 흐르고, 꺼졌다고 문서가 영원히
 * 남으면 안 된다(켜진 적이 없으면 표가 비어 있어 아무것도 하지 않는다).
 */
import { isCronAuthorized } from '@work/lib/ops/cron-auth'
import { runMemberDocumentRetention } from '@/lib/memberDocuments/retention'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/member-documents/retention')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle(request: Request) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return ApiError.unauthorized('권한이 없습니다.').toNextResponse()
  }
  try {
    const result = await runMemberDocumentRetention(new Date())
    return ApiSuccess.ok(result).toNextResponse()
  } catch (e) {
    log.error('보존 정리 실패', { error: e instanceof Error ? e.name : typeof e })
    return ApiError.internalServerError('문서함 보존 정리에 실패했습니다.').toNextResponse()
  }
}

export const GET = handle
export const POST = handle
