/**
 * 이사회 업무툴 삭제 메시지 영구 삭제 (크론 전용, 매일) — 원본 kosmart-work `/api/internal/purge-deleted`.
 *
 * 삭제 30일이 지난 메시지를 영구 삭제하고 첨부 객체·썸네일·미리보기 캐시를 지운다. 살아 있는 답글이 달린 글과
 * 다른 버전이 살아 있는 문서 계보의 첨부를 가진 글은 남긴다(`src/work/lib/ops/cleanup.ts`).
 *
 * 인증: `CRON_SECRET` Bearer, 없으면 닫는다(`withBoardWorkCron`).
 */
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { withBoardWorkCron } from '@work/lib/ops/cron-alert'
import { purgeDeletedMessages } from '@work/lib/ops/cleanup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle() {
  try {
    const result = await purgeDeletedMessages()
    if (result.stalled) {
      // 지울 수 있는 메시지가 없는데 후보만 가득 찼다 — 보존 대상이 앞을 막고 있다. 5xx로 알린다
      console.error('[purge-deleted] 정체 감지:', result)
      return ApiError.internalServerError('삭제 메시지 정리가 정체됐습니다.').toNextResponse()
    }
    return ApiSuccess.ok(result).toNextResponse()
  } catch (err) {
    console.error('[purge-deleted] 실패:', err instanceof Error ? err.name : err)
    return ApiError.internalServerError('삭제 메시지 정리에 실패했습니다.').toNextResponse()
  }
}

const guarded = withBoardWorkCron('purge-deleted', handle)
export const GET = guarded
export const POST = guarded
