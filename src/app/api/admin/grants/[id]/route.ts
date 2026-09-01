import { z } from 'zod'

import { getGrantDigestById, updateGrantDigest, type GrantItem } from '@/db/queries/grantDigests'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const GET = defineApiRoute({
  method: 'GET',
  name: 'admin.grants.get',
  rateLimit: { ...RATE_LIMITS.ADMIN_API, keyGenerator: createUserKeyGenerator('admin_grants') },
  rateLimitHeaders: true,
  auth: 'admin',
  handler: async ({ params }) => {
    const digest = await getGrantDigestById(String(params.id))
    if (!digest) throw ApiError.notFound('회차를 찾을 수 없습니다.')
    return ApiSuccess.ok({ digest })
  },
})

const itemSchema = z
  .object({
    key: z.string().min(1),
    source: z.string(),
    source_id: z.string(),
    title: z.string().min(1),
    genres: z.array(z.string()),
    regions: z.array(z.string()),
    category: z.string(),
    apply_start: z.string().nullable(),
    apply_end: z.string().nullable(),
    url: z.string().url(),
    summary: z.string().nullable(),
    biz_type: z.string().nullable(),
    target: z.string().nullable(),
    excluded: z.boolean().optional(),
    manual: z.boolean().optional(),
  })
  .strict()

const patchSchema = z
  .object({
    items: z.array(itemSchema).max(60),
  })
  .strict()

export const PATCH = defineApiRoute<Record<string, unknown>>({
  method: 'PATCH',
  name: 'admin.grants.update',
  rateLimit: { ...RATE_LIMITS.ADMIN_API, keyGenerator: createUserKeyGenerator('admin_grants') },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  handler: async ({ params, body }) => {
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      throw ApiError.badRequest('항목 형식이 올바르지 않습니다.')
    }

    const id = String(params.id)
    const existing = await getGrantDigestById(id)
    if (!existing) throw ApiError.notFound('회차를 찾을 수 없습니다.')
    // 이미 나간 회차를 고치면 게시글·메일과 기록이 어긋난다.
    if (existing.status !== 'draft') {
      throw ApiError.badRequest('초안 상태의 회차만 편집할 수 있습니다.')
    }
    // 이 프로젝트는 tsconfig `strict: false`(strictNullChecks 꺼짐)라 zod의
    // 필수/옵셔널 키 추론이 깨져 z.infer가 전 필드를 optional로 보여준다
    // (zod는 strictNullChecks를 요구한다). 런타임 검증(.strict() 스키마)은
    // 이미 위 safeParse가 했으므로 여기서는 형만 맞춰준다.
    const updated = await updateGrantDigest(id, { items: parsed.data.items as GrantItem[] })
    return ApiSuccess.ok({ digest: updated })
  },
})
