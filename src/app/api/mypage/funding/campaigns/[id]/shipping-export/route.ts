/**
 * 배송 목록 내려받기 — 개설자가 여든 개의 소포를 부칠 때 쓰는 파일.
 *
 * **이것은 남의 이름·전화번호·집 주소를 한꺼번에 읽는 행위다.** 그래서 네
 * 가지를 지킨다.
 *
 * ① **볼 수 있는 사람**은 대시보드와 같다 — 그 캠페인의 개설자와 사무국
 * (`canManageCampaign`). 같은 값이 이미 대시보드 표에 그대로 보이므로 여기서
 * 더 좁히면 "화면으로는 보이는데 파일로는 안 되는" 앞뒤가 안 맞는 경계가
 * 된다. 사무국을 넣는 이유는 배송 사고와 환불 문의가 사무국으로 오기
 * 때문이다.
 *
 * ② **두 가지 판본**을 준다 — 엑셀에서 열 파일과 택배사 양식에 올릴 파일.
 * 왜 하나로는 안 되는지는 `@/lib/funding/shippingExport`에 적어 두었다.
 *
 * ③ **흔적을 남긴다.** 메일함 첨부 다운로드
 * (`src/app/api/admin/mailbox/[id]/attachments/[attachmentId]/download/route.ts`)와
 * **같은 모양**이다: 본문을 내보내기 **전에 기록을 기다리고**, 접속 주소와
 * 브라우저를 함께 남기며, 기록이 실패하면 `logSecurityEvent`로 올린다. 순서가
 * 중요하다 — 응답을 내보낸 뒤에 남기려 들면 서버리스 함수가 얼어붙어 기록이
 * 통째로 사라질 수 있고, 그러면 후원자 전원의 주소가 **아무 흔적도 경보도
 * 없이** 나간다. 기록 실패가 내려받기를 막지는 않는다(본 작업은 정당한
 * 요청이다).
 *
 * ④ **빈도를 막는다.** 후원자 전원을 한 번에 읽는 무거운 조회다. 후원 취소
 * 라우트와 같은 모양으로 IP 기준 상한을 건다.
 *
 * 기능 스위치를 인증보다 먼저 보는 순서는 다른 펀딩 라우트와 같다 — 이유는
 * 이행 라우트의 머리말에 적어 두었다.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireCampaignActor } from '@/lib/server/memberAuth'
import { getCampaignById } from '@/db/queries/funding'
import { listShippingPledges } from '@/db/queries/fundingPledges'
import { logUserActivity } from '@/db/queries/activities'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import {
  buildShippingCsv,
  parseShippingExportFormat,
  shippingExportDisposition,
} from '@/lib/funding/shippingExport'
import { isFundingEnabled } from '@/lib/funding/settings'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('api/mypage/funding/shipping-export')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isFundingEnabled()))
    return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()

  const rl = await applyRouteRateLimit(request, {
    name: 'funding_shipping_export',
    windowMs: 60_000,
    maxRequests: 10,
    message: '요청이 너무 잦습니다.',
    keyGenerator: createIPKeyGenerator('funding-shipping-export'),
  })
  if (!rl.success && rl.response?.status === 429) return rl.response

  const auth = await requireCampaignActor()
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const campaign = await getCampaignById(id)
  if (
    !campaign ||
    !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
  ) {
    return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
  }

  const format = parseShippingExportFormat(request.nextUrl.searchParams.get('format'))
  const rows = await listShippingPledges(id)
  const csv = buildShippingCsv(rows, format)

  // 기록은 내보내기 **전에**, 기다려서 남긴다 — 위 머리말 ③.
  try {
    await logUserActivity({
      user_id: auth.user.id,
      action_type: 'funding_shipping_exported',
      target_type: 'funding_campaign',
      target_id: id,
      metadata: { rows: rows.length, format },
      ip_address:
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
      user_agent: request.headers.get('user-agent') || null,
    })
  } catch (logError) {
    logSecurityEvent(
      'FUNDING_SHIPPING_EXPORT_AUDIT_FAILED',
      {
        campaignId: id,
        rows: rows.length,
        error: logError instanceof Error ? logError.message : String(logError),
      },
      'high'
    )
    log.error('배송 목록 내보내기 기록 실패', {
      campaignId: id,
      error: logError instanceof Error ? logError.message : String(logError),
    })
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      // charset을 적어 두면 브라우저 미리보기에서도 한글이 깨지지 않는다.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': shippingExportDisposition(campaign.title, new Date(), format),
      // 개인정보가 담긴 응답이다. 어떤 공유 캐시에도 남기지 않는다.
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
