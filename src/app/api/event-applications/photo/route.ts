import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  distributedRateLimiter,
  DISTRIBUTED_RATE_LIMIT_CONFIGS,
  createDistributedIPKeyGenerator,
} from '@/utils/distributedRateLimiter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export async function POST(request: NextRequest) {
  const limiter = await distributedRateLimiter.applyRateLimit({
    ...DISTRIBUTED_RATE_LIMIT_CONFIGS.POST_CREATION,
    keyGenerator: createDistributedIPKeyGenerator('event-app-photo'),
    message: '업로드가 너무 빠릅니다. 잠시 후 다시 시도해주세요.',
  })
  const rateLimitResult = await limiter(request)
  if (!rateLimitResult.success) {
    return ApiError.tooManyRequests(
      '업로드가 너무 빠릅니다. 잠시 후 다시 시도해주세요.'
    ).toNextResponse()
  }

  try {
    const eventSlug = request.nextUrl.searchParams.get('event_slug')
    if (!eventSlug) {
      return ApiError.badRequest('event_slug 파라미터가 필요합니다.').toNextResponse()
    }

    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return ApiError.badRequest('파일이 없습니다.').toNextResponse()
    }

    if (!file.type.startsWith('image/')) {
      return ApiError.badRequest('이미지 파일만 업로드 가능합니다.').toNextResponse()
    }

    if (file.size > MAX_FILE_SIZE) {
      return ApiError.badRequest('파일 크기는 5MB 이하여야 합니다.').toNextResponse()
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`
    const storagePath = `event-applications/${eventSlug}/${fileName}`

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      return ApiError.internalServerError('서버 구성 오류입니다.').toNextResponse()
    }

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const arrayBuffer = await file.arrayBuffer()
    const { error: uploadError } = await db.storage
      .from('attachments')
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('[event-app-photo] upload error:', uploadError)
      return ApiError.internalServerError('파일 업로드 중 오류가 발생했습니다.').toNextResponse()
    }

    const { data: publicUrlData } = db.storage.from('attachments').getPublicUrl(storagePath)

    return ApiSuccess.ok({ url: publicUrlData.publicUrl }, '업로드 완료').toNextResponse()
  } catch {
    return ApiError.internalServerError('파일 업로드 중 오류가 발생했습니다.').toNextResponse()
  }
}

export async function GET() {
  return ApiError.methodNotAllowed('POST 요청만 허용됩니다.').toNextResponse()
}
