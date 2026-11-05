import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { countLabels, createLabel, listLabels } from '@/db/queries/mailboxLabels'
import { MAX_LABELS, isMailLabelColor, normalizeLabelName } from '@/lib/mail/labels'
import { logSecurityEvent } from '@/utils/security'

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

// GET: 라벨 목록(메일 수 포함) — 이사·감사·관리자. 거르기 칩을 그리는 데 쓴다.
export const GET = defineApiRoute<undefined, BoardAuthSuccess>({
  method: 'GET',
  name: 'api/admin/mailbox/labels',
  rateLimit,
  auth: 'board-member',
  errorResponse,
  handler: async () => ApiSuccess.ok({ labels: await listLabels() }),
})

// POST: 라벨 만들기 — 관리자만. 이름은 대소문자 무시로 겹칠 수 없고(DB 유일 인덱스), 색은 팔레트 키만.
export const POST = defineApiRoute<{ name?: unknown; color?: unknown }>({
  method: 'POST',
  name: 'api/admin/mailbox/labels',
  rateLimit,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse,
  handler: async ({ body }) => {
    const name = normalizeLabelName(body?.name)
    if (!name) throw ApiError.badRequest('라벨 이름은 1~30자로 입력해 주세요.')
    const color = body?.color === undefined ? 'gray' : body.color
    if (!isMailLabelColor(color)) throw ApiError.badRequest('알 수 없는 색입니다.')
    if ((await countLabels()) >= MAX_LABELS) {
      throw ApiError.badRequest(`라벨은 ${MAX_LABELS}개까지 만들 수 있습니다.`)
    }
    const created = await createLabel({ name, color })
    if (created === 'duplicate') throw ApiError.conflict('같은 이름의 라벨이 이미 있습니다.')
    return ApiSuccess.created({ label: { ...created, email_count: 0 } })
  },
})
