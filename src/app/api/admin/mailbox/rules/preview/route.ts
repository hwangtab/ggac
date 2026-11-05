import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { countMatchingEmails } from '@/db/queries/mailboxRules'
import { isPublicMailDomain } from '@/lib/mail/senderRules'
import { logSecurityEvent } from '@/utils/security'

import { readRuleMatch } from '../ruleInput'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 규칙 미리보기 — 이 조건에 맞는 기존 메일 수와 공용 메일 도메인 여부(관리자만). 만들기 전에 화면이 알린다.
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/mailbox/rules/preview',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  auth: 'admin',
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('규칙을 미리 보지 못했습니다.').toNextResponse()
  },
  handler: async ({ request }) => {
    const params = request.nextUrl.searchParams
    const { matchType, matchValue } = readRuleMatch(
      params.get('match_type'),
      params.get('match_value')
    )
    return ApiSuccess.ok({
      match_type: matchType,
      match_value: matchValue,
      matching_count: await countMatchingEmails(matchType, matchValue),
      public_domain: matchType === 'domain' && isPublicMailDomain(matchValue),
    })
  },
})
