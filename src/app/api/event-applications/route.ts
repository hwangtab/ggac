import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  distributedRateLimiter,
  DISTRIBUTED_RATE_LIMIT_CONFIGS,
  createDistributedIPKeyGenerator,
} from '@/utils/distributedRateLimiter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

const ApplicationSchema = z.object({
  event_slug: z.string().min(1, '이벤트 슬러그가 필요합니다.'),
  applicant_name: z
    .string()
    .min(1, '신청자/팀명은 필수입니다.')
    .max(100, '100자 이내로 입력해주세요.'),
  contact_email: z.string().email('올바른 이메일 형식을 입력해주세요.'),
  contact_phone: z.string().max(20).optional(),
  performance_info: z.string().max(1000).optional(),
  items_to_sell: z
    .string()
    .min(1, '판매할 물건은 필수입니다.')
    .max(1000, '1000자 이내로 입력해주세요.'),
  links: z.string().max(500).optional(),
  message: z.string().max(1000).optional(),
  participation_type: z.string().min(1, '참여 분야를 선택해주세요.').max(100).optional(),
  photo_url: z.string().url().max(500).optional(),
  privacy_consent: z.literal(true, {
    errorMap: () => ({ message: '개인정보 수집·이용 동의가 필요합니다.' }),
  }),
})

export async function POST(request: NextRequest) {
  const limiter = await distributedRateLimiter.applyRateLimit({
    ...DISTRIBUTED_RATE_LIMIT_CONFIGS.POST_CREATION,
    keyGenerator: createDistributedIPKeyGenerator('event-app'),
    message: '신청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.',
  })
  const rateLimitResult = await limiter(request)
  if (!rateLimitResult.success) {
    return ApiError.tooManyRequests(
      '신청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.'
    ).toNextResponse()
  }

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = ApplicationSchema.safeParse(body)
    if (!parsed.success) {
      const details = parsed.error.issues.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }))
      return ApiError.badRequest('입력 값을 확인해주세요.').toNextResponse()
    }

    const d = parsed.data
    const cleanedData = {
      event_slug: d.event_slug.trim(),
      applicant_name: d.applicant_name.trim(),
      contact_email: d.contact_email.trim().toLowerCase(),
      contact_phone: d.contact_phone?.trim() || null,
      performance_info: d.performance_info?.trim() || null,
      items_to_sell: d.items_to_sell.trim(),
      links: d.links?.trim() || null,
      message: d.message?.trim() || null,
      participation_type: d.participation_type?.trim() || null,
      photo_url: d.photo_url?.trim() || null,
      privacy_consent: true,
      privacy_consent_at: new Date().toISOString(),
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      return ApiError.internalServerError('서버 구성 오류입니다.').toNextResponse()
    }

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: inserted, error: insertError } = await db
      .from('event_applications')
      .insert(cleanedData)
      .select('id')
      .single()

    if (insertError) {
      console.error('[event-applications] insert error:', insertError)
      return ApiError.internalServerError('신청 처리 중 오류가 발생했습니다.').toNextResponse()
    }

    return ApiSuccess.created({ id: inserted.id }, '신청이 접수되었습니다.').toNextResponse()
  } catch {
    return ApiError.internalServerError('신청 처리 중 오류가 발생했습니다.').toNextResponse()
  }
}

export async function GET() {
  return ApiError.methodNotAllowed('POST 요청만 허용됩니다.').toNextResponse()
}
