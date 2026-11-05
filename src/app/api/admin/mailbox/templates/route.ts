import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { AdminAuthSuccess } from '@/lib/server/adminAuth'
import { countTemplates, createTemplate, listTemplates } from '@/db/queries/mailboxTemplates'
import {
  MAX_TEMPLATES,
  TEMPLATE_BODY_MAX,
  TEMPLATE_NAME_MAX,
  normalizeTemplateBody,
  normalizeTemplateName,
} from '@/lib/mail/replyTemplates'
import { logSecurityEvent } from '@/utils/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const rateLimit = {
  ...RATE_LIMITS.ADMIN_API,
  keyGenerator: createUserKeyGenerator('admin_mailbox'),
}
const errorResponse = () => {
  logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
  return ApiError.internalServerError('템플릿을 처리하는 중 오류가 발생했습니다.').toNextResponse()
}

// GET: 답장 템플릿 목록 — 관리자만(답장·새 메일 작성이 관리자만이다).
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/mailbox/templates',
  rateLimit,
  auth: 'admin',
  errorResponse,
  handler: async () => ApiSuccess.ok({ templates: await listTemplates() }),
})

// POST: 템플릿 만들기 — 관리자만. 이름은 대소문자 무시로 겹칠 수 없다(DB 유일 인덱스).
export const POST = defineApiRoute<{ name?: unknown; body?: unknown }, AdminAuthSuccess>({
  method: 'POST',
  name: 'api/admin/mailbox/templates',
  rateLimit,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse,
  handler: async ({ body, auth }) => {
    const name = normalizeTemplateName(body?.name)
    if (!name) throw ApiError.badRequest(`템플릿 이름은 1~${TEMPLATE_NAME_MAX}자로 입력해 주세요.`)
    const text = normalizeTemplateBody(body?.body)
    if (!text) throw ApiError.badRequest(`템플릿 내용은 1~${TEMPLATE_BODY_MAX}자로 입력해 주세요.`)
    if ((await countTemplates()) >= MAX_TEMPLATES) {
      throw ApiError.badRequest(`템플릿은 ${MAX_TEMPLATES}개까지 만들 수 있습니다.`)
    }
    const created = await createTemplate({ name, body: text, created_by: auth.user.id })
    if (created === 'duplicate') throw ApiError.conflict('같은 이름의 템플릿이 이미 있습니다.')
    return ApiSuccess.created({ template: { id: created.id, name, body: text } })
  },
})
