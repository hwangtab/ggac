import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { parseIntegerParam } from '@/utils/queryParams'
import { validateUUID } from '@/utils/validation'
import { parseActivityActionType, parseActivityTargetType } from '@/constants/activity'
import { listActivitiesWithProfile } from '@/db/queries/activities'

/**
 * 사용자별 활동 조회 API
 * GET /api/admin/activities/users
 */
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/activities/users',
  rateLimit: RATE_LIMITS.ADMIN_API,
  auth: 'admin',
  errorMessage: '서버 오류가 발생했습니다.',
  handler: async ({ request }) => {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')
    let sanitizedUserId: string | null = null
    if (userId) {
      const userIdValidation = validateUUID(userId, '사용자 ID')
      if (!userIdValidation.isValid) {
        return ApiError.badRequest(
          userIdValidation.errors[0] || '잘못된 사용자 ID입니다.'
        ).toNextResponse()
      }
      sanitizedUserId = userIdValidation.sanitized
    }
    const page = parseIntegerParam(searchParams.get('page'), 1, { min: 1 })
    const limit = parseIntegerParam(searchParams.get('limit'), 50, { min: 1, max: 100 })
    const days = parseIntegerParam(searchParams.get('days'), 30, { min: 1, max: 365 })
    const actionTypeParam = searchParams.get('action_type')
    const targetTypeParam = searchParams.get('target_type')
    const actionType = actionTypeParam ? parseActivityActionType(actionTypeParam) : null
    const targetType = targetTypeParam ? parseActivityTargetType(targetTypeParam) : null

    if (actionTypeParam && !actionType) {
      return ApiError.badRequest('잘못된 활동 유형입니다.').toNextResponse()
    }
    if (targetTypeParam && !targetType) {
      return ApiError.badRequest('잘못된 대상 유형입니다.').toNextResponse()
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // 단계 4: 수동 Supabase 쿼리(member_profiles!user_id 임베드 +
    // {count:'exact'} + .range())를 Turso 쿼리 계층
    // (listActivitiesWithProfile)으로 대체했다.
    let activities: Awaited<ReturnType<typeof listActivitiesWithProfile>>['rows']
    let count: number
    try {
      const result = await listActivitiesWithProfile({
        userId: sanitizedUserId,
        actionType,
        targetType,
        startDate,
        page,
        limit,
      })
      activities = result.rows
      count = result.total
    } catch {
      return ApiError.internalServerError('활동 데이터 조회에 실패했습니다.').toNextResponse()
    }

    const totalCount = count || 0
    const totalPages = Math.ceil(totalCount / limit)
    const hasNext = page < totalPages
    const hasPrev = page > 1

    return ApiSuccess.ok({
      activities: activities || [],
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNext,
        hasPrev,
      },
      filters: {
        userId: sanitizedUserId,
        days,
        actionType,
        targetType,
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        period: `${days}일`,
        startDate: startDate.toISOString(),
      },
    })
  },
})
