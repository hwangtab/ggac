import { NextResponse } from 'next/server'

import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { createSettingsAdminAuth } from '@/lib/server/settingsAdminAuth'
import { countUnverifiedApprovedMembers } from '@/db/queries/profiles'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { createOptionsResponse } from '@/utils/apiResponse'
import { createLogger } from '@/utils/logger'

/**
 * 이메일 인증 관문을 켜면 **몇 명이 막히는가**. 관리자 설정 화면의 스위치
 * 옆에 이 숫자를 띄운다.
 *
 * 왜 따로 두는가 — `GET /api/admin/settings`는 저장된 설정을 그대로 실어
 * 나르고 그 응답이 곧 저장 페이로드의 바탕(`diffSettings`)이 된다. 저장할 수
 * 없는 관측값을 그 객체에 얹으면 화면이 그것을 되돌려 보내려 하고, PUT
 * 스키마는 `.strict()`라 요청 전체가 400으로 떨어진다.
 *
 * 누가 보는가 — 설정 화면과 같은 관문(`requireSettingsAdmin`)이다. 조합원의
 * 인증 상태를 세는 숫자라 일반 조합원에게 열 이유가 없다. 개별 회원이
 * 누구인지는 내려보내지 않는다 — 켜기 전에 알아야 하는 것은 규모다.
 */
const log = createLogger('admin/settings/email-verification')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/settings/email-verification',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_settings_email_verification'),
  },
  rateLimitHeaders: true,
  auth: createSettingsAdminAuth({
    unauthorizedResponse: () => ApiError.unauthorized('인증이 필요합니다.').toNextResponse(),
  }),
  errorResponse: error => {
    log.error('Admin email verification coverage error', error)
    const isPermissionError = error instanceof Error && error.message.includes('권한')
    return NextResponse.json(
      {
        error: isPermissionError
          ? '관리자 권한이 필요합니다.'
          : '이메일 인증 현황을 조회하지 못했습니다.',
      },
      { status: isPermissionError ? 403 : 500 }
    )
  },
  handler: async () => {
    const coverage = await countUnverifiedApprovedMembers()
    return ApiSuccess.ok(coverage)
  },
})

export async function OPTIONS() {
  return createOptionsResponse()
}
