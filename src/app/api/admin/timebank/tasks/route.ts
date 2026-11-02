/**
 * 조합 업무 글(스펙 §6·§7.3, 계획 Task 9).
 *
 * - GET: 조합 업무 글 목록(관리자 지급 화면용). `?page=`.
 * - POST: 조합 업무 글을 올린다. **여기서만 만든다** — 조합원 글쓰기 라우트는
 *   `coop_task`를 거부한다(스펙 §15 H). 전체 스위치와 `coop_tasks_enabled`가 둘 다
 *   `=== true`여야 한다(§7.2: 꺼지면 조합 업무 글·지급 불가 → 403).
 *
 * 자원은 조합원이 스스로 손을 든다(지명·배정 기능은 없다, §6.2).
 */
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { AdminAuthSuccess } from '@/lib/server/adminAuth'
import { auditTimebankAdminWrite, timebankAdminErrorResponse } from '@/lib/server/timebankAdmin'
import {
  COOP_TASKS_OFF_MESSAGE,
  coopTasksOpen,
  parseCoopTaskInput,
} from '@/lib/timebank/adminRules'
import { getTimebankSettings } from '@/lib/timebank/settings'
import { createTimebankListing, listTimebankListings } from '@/db/queries/timebankBoard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/timebank/tasks',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_tasks'),
  },
  auth: 'admin',
  errorResponse: timebankAdminErrorResponse('tasks', '조합 업무 글을 불러오지 못했습니다.'),
  handler: async ({ request }) => {
    const pageRaw = Number(request.nextUrl.searchParams.get('page'))
    const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 1000 ? pageRaw : 1
    const { rows, hasNext } = await listTimebankListings({
      kind: 'coop_task',
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    })
    return ApiSuccess.ok({ tasks: rows, page, has_next: hasNext })
  },
})

export const POST = defineApiRoute<Record<string, unknown>, AdminAuthSuccess>({
  method: 'POST',
  name: 'api/admin/timebank/tasks',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_timebank_tasks'),
  },
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: timebankAdminErrorResponse('tasks', '조합 업무 글을 올리지 못했습니다.'),
  handler: async ({ request, body, auth }) => {
    const settings = await getTimebankSettings()
    if (!coopTasksOpen(settings)) {
      throw ApiError.forbidden(COOP_TASKS_OFF_MESSAGE)
    }

    const parsed = parseCoopTaskInput(body)
    if (parsed.error !== null) throw ApiError.badRequest(parsed.error)

    const { id } = await createTimebankListing(auth.user.id, parsed.value)
    await auditTimebankAdminWrite({
      request,
      actorId: auth.user.id,
      action_type: 'timebank_coop_task_created',
      target_type: 'timebank_listing',
      target_id: id,
      metadata: {
        listing_id: id,
        title: parsed.value.title,
        category: parsed.value.category,
        estimated_minutes: parsed.value.estimated_minutes,
        task_date: parsed.value.task_date,
      },
    })
    return ApiSuccess.created({ id }, '조합 업무 글을 올렸습니다.')
  },
})
