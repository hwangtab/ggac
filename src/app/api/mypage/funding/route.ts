import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/server/memberAuth'
import { getCampaignById, getCampaignProgress, listCampaignsByOwner } from '@/db/queries/funding'
import { listPledgesByUser } from '@/db/queries/fundingPledges'
import { toPublicPledgeFields } from '@/lib/funding/pledgeView'
import { isFundingEnabled } from '@/lib/funding/settings'
import { ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  // 기능 스위치가 꺼져 있으면 개설·수정 라우트가 전부 503으로 거절한다.
  // 그 사실을 화면에도 알려 준다 — 모르면 "새 펀딩 열기"를 눌러 개설 폼을
  // 다 채운 뒤에야 "펀딩을 준비 중입니다"를 보게 된다. 후원 내역은 스위치와
  // 무관하게 언제나 내려간다(이미 후원한 사람의 기록이다).
  const [ownedCampaigns, pledges, fundingEnabled] = await Promise.all([
    listCampaignsByOwner(auth.user.id),
    listPledgesByUser(auth.user.id),
    isFundingEnabled(),
  ])
  // 내 펀딩 목록이 카드에 모인금액·달성률을 보이려면 각 캠페인의 진행 수치가
  // 필요하다 — 공개 목록(`/api/funding/campaigns`)과 같은 방식으로 붙인다.
  const campaigns = await Promise.all(
    ownedCampaigns.map(async c => ({ ...c, progress: await getCampaignProgress(String(c.id)) }))
  )
  // 화면이 각 후원을 캠페인으로 링크하려면 slug가 있어야 한다 — 비회원 조회
  // 라우트(`/api/funding/pledges/lookup`)와 같은 이유로 여기서도 붙인다.
  // 캠페인 수는 적으니 중복 없이 한 번씩만 조회한다.
  const campaignIds = [...new Set(pledges.map(p => String(p.campaign_id)))]
  const campaignRows = await Promise.all(campaignIds.map(id => getCampaignById(id)))
  const slugById = new Map(campaignIds.map((id, i) => [id, campaignRows[i]?.slug ?? null]))
  // 원장 그대로 내보내면 심사 메모·주문번호·결제 식별자까지 본인 화면에
  // 실린다 — 게스트 조회 라우트와 같은 화이트리스트로 좁힌다.
  return ApiSuccess.ok({
    funding_enabled: fundingEnabled,
    campaigns,
    pledges: pledges.map(p => ({
      ...toPublicPledgeFields(p),
      campaign_id: p.campaign_id,
      campaign_slug: slugById.get(String(p.campaign_id)) ?? null,
    })),
  }).toNextResponse()
}
