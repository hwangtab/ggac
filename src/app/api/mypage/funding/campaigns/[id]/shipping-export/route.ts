/**
 * 배송 목록 내려받기 — 개설자가 여든 개의 소포를 부칠 때 쓰는 파일.
 *
 * **이것은 남의 이름·전화번호·집 주소를 한꺼번에 읽는 행위다.** 그래서 세
 * 가지를 지킨다.
 *
 * ① **볼 수 있는 사람**은 대시보드와 같다 — 그 캠페인의 개설자와 사무국
 * (`canManageCampaign`). 같은 값이 이미 대시보드 표에 그대로 보이므로 여기서
 * 더 좁히면 "화면으로는 보이는데 파일로는 안 되는" 앞뒤가 안 맞는 경계가
 * 된다. 사무국을 넣는 이유는 배송 사고와 환불 문의가 사무국으로 오기
 * 때문이다.
 *
 * ② **엑셀에서 안전하게 열리는 파일**을 만든다 — 인코딩·수식·앞의 0 처리는
 * `@/lib/funding/shippingExport`에 이유와 함께 적어 두었다.
 *
 * ③ **흔적을 남긴다** — 누가 언제 어느 캠페인의 몇 건을 내려받았는지
 * (`logUserActivity`). 메일함 첨부 다운로드(`attachment_downloaded`)와 같은
 * 판단이다.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireActiveMember } from '@/lib/server/memberAuth'
import { getCampaignById } from '@/db/queries/funding'
import { listShippingPledges } from '@/db/queries/fundingPledges'
import { logUserActivity } from '@/db/queries/activities'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { buildShippingCsv, shippingExportDisposition } from '@/lib/funding/shippingExport'
import { isFundingEnabled } from '@/lib/funding/settings'
import { ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/funding/shipping-export')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const campaign = await getCampaignById(id)
  if (
    !campaign ||
    !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }

  const rows = await listShippingPledges(id)
  const csv = buildShippingCsv(rows)

  logUserActivity({
    user_id: auth.user.id,
    action_type: 'funding_shipping_exported',
    target_type: 'funding_campaign',
    target_id: id,
    metadata: { rows: rows.length },
  }).catch(e => log.warn('활동 기록 실패', e))

  return new NextResponse(csv, {
    status: 200,
    headers: {
      // charset을 적어 두면 브라우저 미리보기에서도 한글이 깨지지 않는다.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': shippingExportDisposition(campaign.title, new Date()),
      // 개인정보가 담긴 응답이다. 어디에도 남기지 않는다.
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
