import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { AdminAuthSuccess } from '@/lib/server/adminAuth'
import { applyRuleToExisting, countRules, createRule, listRules } from '@/db/queries/mailboxRules'
import { labelExists } from '@/db/queries/mailboxLabels'
import { MAX_RULES, isPublicMailDomain } from '@/lib/mail/senderRules'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

import { readRuleAction, readRuleMatch } from './ruleInput'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const rateLimit = {
  ...RATE_LIMITS.ADMIN_API,
  keyGenerator: createUserKeyGenerator('admin_mailbox'),
}
const errorResponse = () => {
  logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
  return ApiError.internalServerError('규칙을 처리하는 중 오류가 발생했습니다.').toNextResponse()
}

// GET: 발신자 규칙 목록 — 관리자만(규칙 관리 화면).
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/mailbox/rules',
  rateLimit,
  auth: 'admin',
  errorResponse,
  handler: async () => ApiSuccess.ok({ rules: await listRules() }),
})

type RuleBody = {
  match_type?: unknown
  match_value?: unknown
  action?: unknown
  label_id?: unknown
  apply_existing?: unknown
  confirm_public_domain?: unknown
}

// POST: 발신자 규칙 만들기 — 관리자만.
// - 공용 메일 도메인(gmail.com 등) 전체를 거는 규칙은 `confirm_public_domain: true`가 있어야 한다(조합원 메일까지
//   휩쓸리지 않게 한 번 더 확인받는다). 화면은 미리보기로 이 사실을 먼저 알린다.
// - `apply_existing`이면 지난 메일에도 적용한다(상태 규칙은 안 읽음·읽음인 메일만).
export const POST = defineApiRoute<RuleBody, AdminAuthSuccess>({
  method: 'POST',
  name: 'api/admin/mailbox/rules',
  rateLimit,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse,
  handler: async ({ body, auth }) => {
    const { matchType, matchValue } = readRuleMatch(body?.match_type, body?.match_value)
    const action = readRuleAction(body?.action)

    let labelId: string | null = null
    if (action === 'label') {
      const check = validateUUID(String(body?.label_id ?? ''), '라벨 ID')
      if (!check.isValid) throw ApiError.badRequest('붙일 라벨을 골라 주세요.')
      if (!(await labelExists(check.sanitized)))
        throw ApiError.badRequest('라벨을 찾을 수 없습니다.')
      labelId = check.sanitized
    }

    if (
      matchType === 'domain' &&
      isPublicMailDomain(matchValue) &&
      body?.confirm_public_domain !== true
    ) {
      throw ApiError.badRequest(
        `${matchValue}는 여러 사람이 쓰는 메일 서비스입니다. 도메인 전체에 규칙을 걸면 조합원·협력처 메일도 함께 처리됩니다. 정말 걸려면 한 번 더 확인해 주세요.`
      )
    }
    if ((await countRules()) >= MAX_RULES) {
      throw ApiError.badRequest(`규칙은 ${MAX_RULES}개까지 만들 수 있습니다.`)
    }

    const created = await createRule({
      match_type: matchType,
      match_value: matchValue,
      action,
      label_id: labelId,
      created_by: auth.user.id,
    })
    if (created === 'duplicate') throw ApiError.conflict('같은 규칙이 이미 있습니다.')

    const appliedExisting =
      body?.apply_existing === true
        ? await applyRuleToExisting({
            match_type: matchType,
            match_value: matchValue,
            action,
            label_id: labelId,
          })
        : 0
    return ApiSuccess.created({ id: created.id, applied_existing: appliedExisting })
  },
})
