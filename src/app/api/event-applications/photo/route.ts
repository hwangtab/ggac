import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, applyRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { isValidEventSlug, normalizeEventSlug } from '@/utils/eventApplicationValidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MAGIC_BYTE_SIGNATURES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
}

function hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTE_SIGNATURES[mimeType]
  if (!signatures) return false

  return signatures.some(signature => signature.every((byte, index) => buffer[index] === byte))
}

export async function POST(request: NextRequest) {
  const limiter = await applyRateLimit({
    ...RATE_LIMITS.POST_CREATION,
    keyGenerator: createIPKeyGenerator('event-app-photo'),
    message: '업로드가 너무 빠릅니다. 잠시 후 다시 시도해주세요.',
  })
  const rateLimitResult = await limiter(request)
  if (!rateLimitResult.success) {
    return ApiError.tooManyRequests(
      '업로드가 너무 빠릅니다. 잠시 후 다시 시도해주세요.'
    ).toNextResponse()
  }

  try {
    const eventSlug = normalizeEventSlug(request.nextUrl.searchParams.get('event_slug') || '')
    if (!eventSlug) {
      return ApiError.badRequest('event_slug 파라미터가 필요합니다.').toNextResponse()
    }
    if (!isValidEventSlug(eventSlug)) {
      return ApiError.badRequest('event_slug 형식이 올바르지 않습니다.').toNextResponse()
    }

    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return ApiError.badRequest('파일이 없습니다.').toNextResponse()
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return ApiError.badRequest('이미지 파일만 업로드 가능합니다.').toNextResponse()
    }

    if (file.size > MAX_FILE_SIZE) {
      return ApiError.badRequest('파일 크기는 5MB 이하여야 합니다.').toNextResponse()
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (!hasValidImageSignature(buffer, file.type)) {
      return ApiError.badRequest('이미지 파일 형식이 올바르지 않습니다.').toNextResponse()
    }

    const ext = EXTENSION_BY_TYPE[file.type]
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`
    const storagePath = `event-applications/${eventSlug}/${fileName}`

    let db
    try {
      db = createServiceRoleClient()
    } catch {
      return ApiError.internalServerError('서버 구성 오류입니다.').toNextResponse()
    }

    const { error: uploadError } = await db.storage
      .from('attachments')
      .upload(storagePath, buffer, {
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
