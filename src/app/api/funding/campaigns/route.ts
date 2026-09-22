import { listPublicCampaigns, getCampaignProgress } from '@/db/queries/funding'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/funding/campaigns')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const campaigns = await listPublicCampaigns()
    const withProgress = await Promise.all(
      campaigns.map(async c => ({ ...c, progress: await getCampaignProgress(String(c.id)) }))
    )
    return ApiSuccess.ok({ campaigns: withProgress }).toNextResponse()
  } catch (error) {
    log.error('목록 실패:', error)
    return ApiError.internalServerError('목록을 불러오지 못했습니다.').toNextResponse()
  }
}
