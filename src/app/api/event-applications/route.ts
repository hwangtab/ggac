import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, applyRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import {
  EVENT_SLUG_PATTERN,
  isValidEventApplicationPhotoUrl,
  normalizeEventSlug,
} from '@/utils/eventApplicationValidation'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { createEventApplication, hasEventApplicationForContact } from '@/db/queries/misc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

const ApplicationSchema = z.object({
  event_slug: z
    .string()
    .min(1, '이벤트 슬러그가 필요합니다.')
    .transform(normalizeEventSlug)
    .refine(value => EVENT_SLUG_PATTERN.test(value), {
      message: '이벤트 슬러그 형식이 올바르지 않습니다.',
    }),
  applicant_name: z
    .string()
    .min(1, '신청자/팀명은 필수입니다.')
    .max(100, '100자 이내로 입력해주세요.'),
  contact_email: z
    .string()
    .refine(v => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()), {
      message: '올바른 이메일 형식을 입력해주세요.',
    })
    .optional(),
  contact_phone: z.string().min(1, '연락처는 필수입니다.').max(20),
  // 마켓류는 폼에서 필수로 받지만, 워크샵 등 다른 행사 유형은 미사용 → 서버에선 선택 처리
  performance_info: z.string().max(1000).optional(),
  items_to_sell: z.string().max(1000, '1000자 이내로 입력해주세요.').optional(),
  links: z.string().max(500).optional(),
  message: z.string().max(1000).optional(),
  participation_type: z.string().min(1, '참여 분야를 선택해주세요.').max(100).optional(),
  photo_url: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine(isValidEventApplicationPhotoUrl, {
      message: '업로드된 신청 사진 URL만 사용할 수 있습니다.',
    })
    .optional(),
  privacy_consent: z.literal(true, {
    errorMap: () => ({ message: '개인정보 수집·이용 동의가 필요합니다.' }),
  }),
})

export async function POST(request: NextRequest) {
  const limiter = await applyRateLimit({
    ...RATE_LIMITS.POST_CREATION,
    keyGenerator: createIPKeyGenerator('event-app'),
    message: '신청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.',
  })
  const rateLimitResult = await limiter(request)
  if (!rateLimitResult.success) {
    return ApiError.tooManyRequests(
      '신청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.'
    ).toNextResponse()
  }

  try {
    const body = await parseJsonObjectBody(request)
    if (!body) {
      return ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse()
    }

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
      event_slug: d.event_slug,
      applicant_name: d.applicant_name.trim(),
      contact_email: d.contact_email?.trim().toLowerCase() || null,
      contact_phone: d.contact_phone.trim(),
      performance_info: d.performance_info?.trim() || null,
      items_to_sell: d.items_to_sell?.trim() || null,
      links: d.links?.trim() || null,
      message: d.message?.trim() || null,
      participation_type: d.participation_type?.trim() || null,
      photo_url: d.photo_url?.trim() || null,
      privacy_consent: true,
      privacy_consent_at: new Date().toISOString(),
    }

    // 애플리케이션 단계의 중복 검사. insert 전 SELECT라 원자적이지 않다 —
    // 동시에 들어온 두 요청은 둘 다 이 검사를 통과할 수 있다(경합에 뚫린다).
    // 그래서 여기는 사용자에게 친절한 메시지를 주기 위한 1차 관문일 뿐이고,
    // 실제 방어선은 `event_applications_slug_phone_idx`(마이그레이션 0014)다.
    // 경합으로 이 검사를 통과한 두 번째 INSERT는 아래 catch가 409로 돌려준다.
    let alreadyApplied: boolean
    try {
      alreadyApplied = await hasEventApplicationForContact(
        cleanedData.event_slug,
        cleanedData.contact_phone
      )
    } catch (checkError) {
      console.error('[event-applications] duplicate check error:', checkError)
      return ApiError.internalServerError('신청 처리 중 오류가 발생했습니다.').toNextResponse()
    }
    if (alreadyApplied) {
      return ApiError.conflict('이미 같은 연락처로 신청이 접수되어 있습니다.').toNextResponse()
    }

    let inserted: { id: string }
    try {
      inserted = await createEventApplication(cleanedData)
    } catch (insertError) {
      // 유니크 인덱스 위반 = 경합으로 뚫린 중복 신청. 서버 장애가 아니므로
      // 위의 1차 검사와 같은 409·같은 문구로 돌려준다(사용자에게는 구분이
      // 없어야 한다). SQLite는 위반을 메시지로만 알려주므로 문자열로 본다.
      const message = insertError instanceof Error ? insertError.message : ''
      if (/UNIQUE constraint failed/i.test(message)) {
        return ApiError.conflict('이미 같은 연락처로 신청이 접수되어 있습니다.').toNextResponse()
      }
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
