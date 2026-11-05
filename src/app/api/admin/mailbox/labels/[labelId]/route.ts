import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { deleteLabel, updateLabel } from '@/db/queries/mailboxLabels'
import { isMailLabelColor, normalizeLabelName } from '@/lib/mail/labels'
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
  return ApiError.internalServerError('라벨을 처리하는 중 오류가 발생했습니다.').toNextResponse()
}

function readLabelId(params: Record<string, unknown>): string {
  const check = validateUUID(String(params.labelId ?? ''), '라벨 ID')
  if (!check.isValid) throw ApiError.badRequest('유효한 라벨 id가 필요합니다.')
  return check.sanitized
}

// PATCH: 라벨 이름·색 바꾸기 — 관리자만.
export const PATCH = defineApiRoute<{ name?: unknown; color?: unknown }>({
  method: 'PATCH',
  name: 'api/admin/mailbox/labels/[labelId]',
  rateLimit,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse,
  handler: async ({ body, params }) => {
    const id = readLabelId(params)
    let name: string | undefined
    if (body?.name !== undefined) {
      const normalized = normalizeLabelName(body.name)
      if (!normalized) throw ApiError.badRequest('라벨 이름은 1~30자로 입력해 주세요.')
      name = normalized
    }
    if (body?.color !== undefined && !isMailLabelColor(body.color)) {
      throw ApiError.badRequest('알 수 없는 색입니다.')
    }
    const color = body?.color as string | undefined
    if (name === undefined && color === undefined)
      throw ApiError.badRequest('바꿀 내용이 없습니다.')
    const outcome = await updateLabel({ id, name, color })
    if (outcome === 'missing') throw ApiError.notFound('라벨을 찾을 수 없습니다.')
    if (outcome === 'duplicate') throw ApiError.conflict('같은 이름의 라벨이 이미 있습니다.')
    return ApiSuccess.ok({
      id,
      ...(name !== undefined ? { name } : {}),
      ...(color ? { color } : {}),
    })
  },
})

// DELETE: 라벨 지우기 — 관리자만. 메일에 붙은 연결도 함께 지워진다(메일 자체는 그대로다).
export const DELETE = defineApiRoute({
  method: 'DELETE',
  name: 'api/admin/mailbox/labels/[labelId]',
  rateLimit,
  auth: 'admin',
  errorResponse,
  handler: async ({ params }) => {
    const id = readLabelId(params)
    if (!(await deleteLabel(id))) throw ApiError.notFound('라벨을 찾을 수 없습니다.')
    return ApiSuccess.ok({ id, deleted: true })
  },
})
