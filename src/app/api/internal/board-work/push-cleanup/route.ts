/**
 * 이사회 업무툴 만료 푸시 구독 정리 (크론 전용, 매일) — 원본 kosmart-work `/api/internal/push-cleanup`.
 * last_seen_at이 90일 지난 구독을 지운다(원본의 2단계 인증 행 정리는 ggac에 그 기능이 없어 뺐다).
 *
 * 인증: `CRON_SECRET` Bearer, 없으면 닫는다(`withBoardWorkCron`).
 */
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { withBoardWorkCron } from '@work/lib/ops/cron-alert'
import { cleanupStalePushSubscriptions } from '@work/lib/ops/cleanup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle() {
  try {
    return ApiSuccess.ok(await cleanupStalePushSubscriptions()).toNextResponse()
  } catch (err) {
    console.error('[push-cleanup] 실패:', err)
    return ApiError.internalServerError('만료 구독 정리에 실패했습니다.').toNextResponse()
  }
}

const guarded = withBoardWorkCron('push-cleanup', handle)
export const GET = guarded
export const POST = guarded
