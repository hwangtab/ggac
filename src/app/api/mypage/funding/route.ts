import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/server/memberAuth'
import { listCampaignsByOwner } from '@/db/queries/funding'
import { listPledgesByUser } from '@/db/queries/fundingPledges'
import { ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const [campaigns, pledges] = await Promise.all([
    listCampaignsByOwner(auth.user.id),
    listPledgesByUser(auth.user.id),
  ])
  return ApiSuccess.ok({ campaigns, pledges }).toNextResponse()
}
