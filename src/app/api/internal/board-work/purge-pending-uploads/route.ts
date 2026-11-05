/**
 * 이사회 업무툴 임시 업로드 정리 (크론 전용, 매일) — 원본 kosmart-work `/api/internal/purge-pending-uploads`.
 *
 * 메시지에 붙지 못한 채 24시간 지난 임시 업로드의 객체·행을 지우고, 행 없이 저장소에만 남은 `board-work/files/` 객체(고아)도
 * 상한 안에서 지운다. 지울 키는 전부 `isSafeBoardWorkPath`를 지난 것뿐이다 — 같은 비공개 저장소의 DB 백업·메일 첨부·
 * 이사회 서류는 건드리지 않는다(`src/work/lib/files/cleanup-plan.ts`).
 *
 * 이어서 행 없이 남은 이사회 서류 객체(`board-documents/` — 올리고 등록하지 않은 업로드, 승격 전에 끊긴 앱 편집 저장본)를
 * 같은 상한·대량 삭제 차단기로 지운다(`src/lib/boardDocuments/orphans.ts`). 이 단계의 실패는 응답을 바꾸지 않는다.
 *
 * 인증: `CRON_SECRET` Bearer, 없으면 닫는다(`withBoardWorkCron`).
 */
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { withBoardWorkCron } from '@work/lib/ops/cron-alert'
import { purgeStalePendingUploads } from '@work/lib/ops/cleanup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle() {
  const result = await purgeStalePendingUploads()
  if (result.error) {
    console.error('[purge-pending-uploads] 중간 실패:', result)
    return ApiError.internalServerError(`임시 업로드 정리 실패: ${result.error}`).toNextResponse()
  }
  return ApiSuccess.ok(result).toNextResponse()
}

const guarded = withBoardWorkCron('purge-pending-uploads', handle)
export const GET = guarded
export const POST = guarded
