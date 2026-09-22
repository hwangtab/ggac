import { NextRequest, NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { listCampaignsForAdmin, getCampaignProgress } from '@/db/queries/funding'
import { ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const status = request.nextUrl.searchParams.get('status') ?? undefined
  const campaigns = await listCampaignsForAdmin({ status })
  const withProgress = await Promise.all(campaigns.map(async c => ({ ...c, progress: await getCampaignProgress(String(c.id)) })))
  return ApiSuccess.ok({ campaigns: withProgress }).toNextResponse()
}
