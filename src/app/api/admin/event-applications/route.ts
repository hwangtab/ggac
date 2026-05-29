import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireAdmin } from '@/lib/server/adminAuth'
import { getProjects } from '@/lib/data'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'icn1'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { db } = auth

  const { searchParams } = new URL(request.url)
  const eventSlug = searchParams.get('event_slug') || ''
  const status = searchParams.get('status') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = 50

  let query = db
    .from('event_applications')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (eventSlug) query = query.eq('event_slug', eventSlug)
  if (status) query = query.eq('status', status)

  const [{ data, error, count }, allProjects] = await Promise.all([query, getProjects()])

  if (error) {
    console.error('[admin/event-applications] fetch error:', error)
    return ApiError.internalServerError('신청 내역을 불러오지 못했습니다.').toNextResponse()
  }

  const events = allProjects
    .filter(p => p.applicationForm?.internal === true)
    .map(p => ({ slug: p.slug, title: p.title }))

  return ApiSuccess.ok(
    {
      applications: data ?? [],
      pagination: {
        currentPage: page,
        totalCount: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
        hasNext: page * limit < (count ?? 0),
      },
      events,
    },
    '신청 내역을 불러왔습니다.'
  ).toNextResponse()
}

const StatusUpdateSchema = z.object({
  id: z.string().uuid('유효한 ID가 필요합니다.'),
  status: z.enum(['pending', 'approved', 'rejected'], {
    errorMap: () => ({ message: 'pending, approved, rejected 중 하나여야 합니다.' }),
  }),
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

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { db } = auth

  const body = await request.json().catch(() => ({}))
  const parsed = StatusUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return ApiError.badRequest('id와 유효한 status가 필요합니다.').toNextResponse()
  }

  const { id, status } = parsed.data

  const { error } = await db
    .from('event_applications')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[admin/event-applications] update error:', error)
    return ApiError.internalServerError('상태 업데이트에 실패했습니다.').toNextResponse()
  }

  return ApiSuccess.ok({ id, status }, '상태가 업데이트되었습니다.').toNextResponse()
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { db } = auth

  const body = await request.json().catch(() => ({}))
  const parsed = FieldUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return ApiError.badRequest('입력 값을 확인해주세요.').toNextResponse()
  }

  const { id, ...fields } = parsed.data
  const updateData = {
    applicant_name: fields.applicant_name.trim(),
    contact_email: fields.contact_email?.trim().toLowerCase() || null,
    contact_phone: fields.contact_phone?.trim() || null,
    performance_info: fields.performance_info?.trim() || null,
    items_to_sell: fields.items_to_sell?.trim() || null,
    links: fields.links?.trim() || null,
    message: fields.message?.trim() || null,
    participation_type: fields.participation_type?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await db.from('event_applications').update(updateData).eq('id', id)

  if (error) {
    console.error('[admin/event-applications] field update error:', error)
    return ApiError.internalServerError('수정에 실패했습니다.').toNextResponse()
  }

  return ApiSuccess.ok({ id }, '신청 정보가 수정되었습니다.').toNextResponse()
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { db } = auth

  const id = new URL(request.url).searchParams.get('id')
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    return ApiError.badRequest('유효한 id 파라미터가 필요합니다.').toNextResponse()
  }

  const { error } = await db.from('event_applications').delete().eq('id', id)

  if (error) {
    console.error('[admin/event-applications] delete error:', error)
    return ApiError.internalServerError('삭제에 실패했습니다.').toNextResponse()
  }

  return ApiSuccess.ok({ id }, '신청이 삭제되었습니다.').toNextResponse()
}

export async function POST() {
  return ApiError.methodNotAllowed('GET, PATCH, PUT, DELETE 요청만 허용됩니다.').toNextResponse()
}
