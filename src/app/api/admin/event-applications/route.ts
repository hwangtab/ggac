import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { defineApiRoute } from '@/lib/server/apiRoute'
import { getProjects } from '@/lib/data'
import {
  EVENT_APPLICATION_STATUSES,
  parseEventApplicationStatus,
} from '@/utils/eventApplicationStatus'
import { parseIntegerParam } from '@/utils/queryParams'
import { isValidEventSlug, normalizeEventSlug } from '@/utils/eventApplicationValidation'
import { validateUUID } from '@/utils/validation'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { eventApplications } from '@/db/schema'
import { logicalPathFromUrl, deletePublicObject } from '@/lib/storage/provider'
import { createLogger } from '@/utils/logger'
import {
  deleteEventApplication,
  listEventApplications,
  updateEventApplicationFields,
  updateEventApplicationStatus,
} from '@/db/queries/misc'

const log = createLogger('api/admin/event-applications')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/event-applications',
  auth: 'admin',
  handler: async ({ request }) => {
    const { searchParams } = new URL(request.url)
    const eventSlugParam = searchParams.get('event_slug') || ''
    const eventSlug = normalizeEventSlug(eventSlugParam)
    const statusParam = searchParams.get('status') || ''
    const status = statusParam ? parseEventApplicationStatus(statusParam) : null
    const page = parseIntegerParam(searchParams.get('page'), 1, { min: 1 })
    const limit = 50

    if (eventSlugParam && !isValidEventSlug(eventSlug)) {
      return ApiError.badRequest('유효한 event_slug 파라미터가 필요합니다.').toNextResponse()
    }

    if (statusParam && !status) {
      return ApiError.badRequest('유효한 status 파라미터가 필요합니다.').toNextResponse()
    }

    let data: Awaited<ReturnType<typeof listEventApplications>>['rows']
    let count: number
    let allProjects: Awaited<ReturnType<typeof getProjects>>
    try {
      const [listResult, projects] = await Promise.all([
        listEventApplications({ eventSlug: eventSlug || null, status, page, limit }),
        getProjects(),
      ])
      data = listResult.rows
      count = listResult.total
      allProjects = projects
    } catch (error) {
      console.error('[admin/event-applications] fetch error:', error)
      return ApiError.internalServerError('신청 내역을 불러오지 못했습니다.').toNextResponse()
    }

    const events = allProjects
      .filter(p => p.applicationForm?.internal === true)
      .map(p => ({ slug: p.slug, title: p.title }))

    return ApiSuccess.ok(
      {
        applications: data,
        pagination: {
          currentPage: page,
          totalCount: count,
          totalPages: Math.ceil(count / limit),
          hasNext: page * limit < count,
        },
        events,
      },
      '신청 내역을 불러왔습니다.'
    ).toNextResponse()
  },
})

const StatusUpdateSchema = z.object({
  id: z.string().uuid('유효한 ID가 필요합니다.'),
  status: z.enum(EVENT_APPLICATION_STATUSES, {
    errorMap: () => ({ message: 'pending, approved, rejected 중 하나여야 합니다.' }),
  }),
  /**
   * 관리자가 화면에서 보고 있던 상태. 이 값이 아직 그대로일 때만 갱신한다
   * (낙관적 잠금). 없으면 무조건 덮어쓰던 예전 동작 — 관리자 둘이 동시에
   * 승인과 거부를 누르면 나중 쓰기가 이긴다.
   */
  expected_status: z
    .enum(EVENT_APPLICATION_STATUSES, {
      errorMap: () => ({ message: 'pending, approved, rejected 중 하나여야 합니다.' }),
    })
    .optional(),
})

const FieldUpdateSchema = z.object({
  id: z.string().uuid('유효한 ID가 필요합니다.'),
  applicant_name: z.string().min(1).max(100),
  // 마켓류는 필수지만 워크샵 등에선 미사용 → 빈 값/누락 허용
  contact_email: z
    .string()
    .max(255)
    .refine(v => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()), {
      message: '올바른 이메일 형식을 입력해주세요.',
    })
    .optional()
    .nullable(),
  contact_phone: z.string().max(20).optional().nullable(),
  performance_info: z.string().max(1000).optional().nullable(),
  items_to_sell: z.string().max(1000).optional().nullable(),
  links: z.string().max(500).optional().nullable(),
  message: z.string().max(1000).optional().nullable(),
  participation_type: z.string().max(100).optional().nullable(),
})

export const PATCH = defineApiRoute<Record<string, unknown>>({
  method: 'PATCH',
  name: 'api/admin/event-applications',
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  handler: async ({ body }) => {
    const parsed = StatusUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return ApiError.badRequest('id와 유효한 status가 필요합니다.').toNextResponse()
    }

    const { id, status, expected_status } = parsed.data
    const idValidation = validateUUID(id, '신청 ID')
    if (!idValidation.isValid) {
      return ApiError.badRequest('유효한 ID가 필요합니다.').toNextResponse()
    }
    const applicationId = idValidation.sanitized

    let updated: boolean
    try {
      updated = await updateEventApplicationStatus(applicationId, status, expected_status)
    } catch (error) {
      console.error('[admin/event-applications] update error:', error)
      return ApiError.internalServerError('상태 업데이트에 실패했습니다.').toNextResponse()
    }

    // rowsAffected가 0이면 두 가지다: 신청이 사라졌거나, 그 사이 다른
    // 관리자가 상태를 바꿨거나. 어느 쪽이든 화면이 낡았으니 새로고침을
    // 요구한다 — 조용히 성공을 돌려주면 관리자는 자기 판단이 반영된 줄 안다.
    if (!updated) {
      return ApiError.conflict(
        '다른 관리자가 먼저 처리했거나 신청이 삭제되었습니다. 목록을 새로고침해 주세요.'
      ).toNextResponse()
    }

    return ApiSuccess.ok(
      { id: applicationId, status },
      '상태가 업데이트되었습니다.'
    ).toNextResponse()
  },
})

export const PUT = defineApiRoute<Record<string, unknown>>({
  method: 'PUT',
  name: 'api/admin/event-applications',
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  handler: async ({ body }) => {
    const parsed = FieldUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return ApiError.badRequest('입력 값을 확인해주세요.').toNextResponse()
    }

    const { id, ...fields } = parsed.data
    const idValidation = validateUUID(id, '신청 ID')
    if (!idValidation.isValid) {
      return ApiError.badRequest('유효한 ID가 필요합니다.').toNextResponse()
    }
    const applicationId = idValidation.sanitized
    const updateData = {
      applicant_name: fields.applicant_name.trim(),
      contact_email: fields.contact_email?.trim().toLowerCase() || null,
      contact_phone: fields.contact_phone?.trim() || null,
      performance_info: fields.performance_info?.trim() || null,
      items_to_sell: fields.items_to_sell?.trim() || null,
      links: fields.links?.trim() || null,
      message: fields.message?.trim() || null,
      participation_type: fields.participation_type?.trim() || null,
    }

    try {
      await updateEventApplicationFields(applicationId, updateData)
    } catch (error) {
      console.error('[admin/event-applications] field update error:', error)
      return ApiError.internalServerError('수정에 실패했습니다.').toNextResponse()
    }

    return ApiSuccess.ok({ id: applicationId }, '신청 정보가 수정되었습니다.').toNextResponse()
  },
})

export const DELETE = defineApiRoute({
  method: 'DELETE',
  name: 'api/admin/event-applications',
  auth: 'admin',
  handler: async ({ request }) => {
    const id = new URL(request.url).searchParams.get('id')
    const idValidation = validateUUID(id ?? '', '신청 ID')
    if (!idValidation.isValid) {
      return ApiError.badRequest('유효한 id 파라미터가 필요합니다.').toNextResponse()
    }
    const applicationId = idValidation.sanitized

    // 삭제 전에 photo_url을 읽어 둔다 — DB 행을 지운 뒤에는 이 값을 다시 얻을
    // 방법이 없다. db/queries/misc.ts에는 id 단건 조회 함수가 없고 이 작업
    // 범위에서 그 파일을 건드릴 수 없어, 딱 이 컬럼 하나만 여기서 직접 읽는다.
    let photoUrl: string | null = null
    try {
      const [row] = await db
        .select({ photoUrl: eventApplications.photoUrl })
        .from(eventApplications)
        .where(eq(eventApplications.id, applicationId))
        .limit(1)
      photoUrl = row?.photoUrl ?? null
    } catch (error) {
      // 조회 실패는 치명적이지 않다 — 아래에서 photoUrl이 null이면 Blob
      // 삭제를 건너뛸 뿐, 신청 삭제 자체는 계속 진행한다.
      log.error('삭제 전 photo_url 조회 실패', { id: applicationId, error })
    }

    try {
      await deleteEventApplication(applicationId)
    } catch (error) {
      console.error('[admin/event-applications] delete error:', error)
      return ApiError.internalServerError('삭제에 실패했습니다.').toNextResponse()
    }

    // DB 행 삭제 성공 후에만 Blob을 지운다(첨부 라우트·board-room 서류
    // 라우트와 같은 순서·같은 근거) — 반대 순서면 Blob 삭제 성공 뒤 DB 삭제가
    // 실패했을 때 신청은 남았는데 사진만 사라진 상태가 된다. 지금 순서의
    // 최악은 "DB에는 없는데 Blob에 사진만 남는" 고아 파일인데, 신청자 삭제가
    // 이미 성공했으므로 되돌릴 수 없는 쪽이 아니라 되돌릴 수 있는 쪽으로
    // 실패하게 만든다. Blob 삭제 실패는 로그만 남기고 요청은 성공 처리한다.
    if (photoUrl) {
      const logical = logicalPathFromUrl(photoUrl, 'attachments', 'event-applications')
      if (logical) {
        try {
          await deletePublicObject(logical)
        } catch (error) {
          log.error('신청 삭제 후 photo Blob 삭제 실패(고아 파일 남음)', {
            id: applicationId,
            photoUrl,
            error,
          })
        }
      } else {
        log.error('안전하지 않은 photo_url이라 Blob 삭제를 건너뜀', {
          id: applicationId,
          photoUrl,
        })
      }
    }

    return ApiSuccess.ok({ id: applicationId }, '신청이 삭제되었습니다.').toNextResponse()
  },
})

export async function POST() {
  return ApiError.methodNotAllowed('GET, PATCH, PUT, DELETE 요청만 허용됩니다.').toNextResponse()
}
