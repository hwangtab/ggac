import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { deleteTemplate, updateTemplate } from '@/db/queries/mailboxTemplates'
import {
  TEMPLATE_BODY_MAX,
  TEMPLATE_NAME_MAX,
  normalizeTemplateBody,
  normalizeTemplateName,
} from '@/lib/mail/replyTemplates'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

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

function readId(params: Record<string, unknown>): string {
  const check = validateUUID(String(params.templateId ?? ''), '템플릿 ID')
  if (!check.isValid) throw ApiError.badRequest('유효한 템플릿 id가 필요합니다.')
  return check.sanitized
}

// PATCH: 템플릿 이름·내용 바꾸기 — 관리자만.
export const PATCH = defineApiRoute<{ name?: unknown; body?: unknown }>({
  method: 'PATCH',
  name: 'api/admin/mailbox/templates/[templateId]',
  rateLimit,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse,
  handler: async ({ body, params }) => {
    const id = readId(params)
    let name: string | undefined
    let text: string | undefined
    if (body?.name !== undefined) {
      const normalized = normalizeTemplateName(body.name)
      if (!normalized) {
        throw ApiError.badRequest(`템플릿 이름은 1~${TEMPLATE_NAME_MAX}자로 입력해 주세요.`)
      }
      name = normalized
    }
    if (body?.body !== undefined) {
      const normalized = normalizeTemplateBody(body.body)
      if (!normalized) {
        throw ApiError.badRequest(`템플릿 내용은 1~${TEMPLATE_BODY_MAX}자로 입력해 주세요.`)
      }
      text = normalized
    }
    if (name === undefined && text === undefined) throw ApiError.badRequest('바꿀 내용이 없습니다.')
    const outcome = await updateTemplate({ id, name, body: text })
    if (outcome === 'missing') throw ApiError.notFound('템플릿을 찾을 수 없습니다.')
    if (outcome === 'duplicate') throw ApiError.conflict('같은 이름의 템플릿이 이미 있습니다.')
    return ApiSuccess.ok({ id })
  },
})

// DELETE: 템플릿 지우기 — 관리자만. 이미 보낸 메일에는 영향이 없다.
export const DELETE = defineApiRoute({
  method: 'DELETE',
  name: 'api/admin/mailbox/templates/[templateId]',
  rateLimit,
  auth: 'admin',
  errorResponse,
  handler: async ({ params }) => {
    const id = readId(params)
    if (!(await deleteTemplate(id))) throw ApiError.notFound('템플릿을 찾을 수 없습니다.')
    return ApiSuccess.ok({ id, deleted: true })
  },
})
