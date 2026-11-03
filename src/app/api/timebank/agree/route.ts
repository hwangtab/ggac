/**
 * 타임뱅크 이용규칙 동의(POST) — 가입 크레딧 또는 재가입 승계 (스펙 §9.3·§9.4).
 *
 * - `requireTimebankAgreer`: 켜져 있고 탈퇴 신청 중이 아니어야 한다. 미동의·구판
 *   동의자가 오는 자리다.
 * - 본문 `{ terms_version }`은 **현재 판과 같아야** 한다 — 화면을 띄워 둔 사이에
 *   판이 바뀌었으면 읽지 않은 판에 동의한 것이 된다.
 * - 재가입 키는 **세션 회원 본인의** `member_profiles` 이메일·전화로 서버가 만든다.
 *   본문의 이메일·전화·키는 받지 않는다. 비밀값(`TIMEBANK_REJOIN_SECRET`)이 없으면
 *   아무것도 주지 않고 500이다 — 키 없이 진행하면 탈퇴자의 음수 잔액 승계가
 *   조용히 빠지고 가입 크레딧이 다시 나간다(fail-closed).
 * - 가입 크레딧이 들어왔으면 `notifyCredited`. 승계(`carryover`)는 회원 → 조합
 *   방향이라 "적립" 알림을 보내지 않는다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireTimebankAgreer, timebankRateLimit } from '@/lib/server/timebankAuth'
import { applyRouteRateLimit } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { rejoinKeysFor, rejoinSecretFromEnv } from '@/lib/timebank/rejoinKey'
import { agreeToTerms, getRejoinIdentity } from '@/db/queries/timebankProfiles'
import { logUserActivity } from '@/db/queries/activities'
import { notifyCredited } from '@/lib/server/timebankNotify'
import { createLogger } from '@/utils/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('timebankAgree')

export async function POST(request: NextRequest) {
  const auth = await requireTimebankAgreer()
  if (auth instanceof NextResponse) return auth
  const { user, settings } = auth

  const rl = await applyRouteRateLimit(request, timebankRateLimit('agree', user.id))
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      const termsVersion = typeof body.terms_version === 'string' ? body.terms_version.trim() : ''
      if (termsVersion !== settings.terms_version) {
        throw ApiError.conflict('이용규칙이 바뀌었습니다. 새로 고친 뒤 다시 읽고 동의해 주세요.')
      }

      let secret: string
      try {
        secret = rejoinSecretFromEnv()
      } catch (error) {
        log.error('재가입 키 비밀값 없음 — 동의를 처리하지 않는다', {
          error: (error as Error)?.message,
        })
        throw ApiError.internalServerError(
          '지금은 동의를 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.'
        )
      }

      const identity = await getRejoinIdentity(user.id)
      const rejoinKeys = rejoinKeysFor(
        { email: identity?.email ?? null, phone: identity?.phone ?? null },
        secret
      )

      const { profile, granted } = await agreeToTerms({
        memberId: user.id,
        termsVersion,
        rejoinKeys,
        settings,
      })

      // 동의는 이미 커밋됐다. 기록이 실패해도 동의를 되돌리지 않는다.
      try {
        await logUserActivity({
          user_id: user.id,
          action_type: 'timebank_agreed',
          metadata: { terms_version: termsVersion, granted },
        })
      } catch (error) {
        log.error('타임뱅크 동의 활동 기록 실패', { error: (error as Error)?.message })
      }

      if (granted === 'signup_grant') {
        await notifyCredited({
          memberId: user.id,
          kind: 'signup_grant',
          minutes: settings.signup_grant_minutes,
        })
      }

      return ApiSuccess.ok(
        {
          terms_version: profile.terms_version,
          agreed_at: profile.agreed_at,
          granted,
        },
        '이용규칙에 동의했습니다.'
      )
    },
    '/api/timebank/agree',
    { userId: user.id }
  )
}
