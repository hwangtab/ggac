import { createErrorResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { parseIntegerParam } from '@/utils/queryParams'

/**
 * 실시간 활성 사용자 조회 API
 * GET /api/admin/activities/real-time
 */
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/activities/real-time',
  rateLimit: RATE_LIMITS.ADMIN_API,
  auth: 'admin',
  errorResponse: () =>
    createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500),
  handler: async ({ request, auth }) => {
    const { db } = auth

    const { searchParams } = new URL(request.url)
    const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: 100 })
    const includeActivity = searchParams.get('include_activity') === 'true'

    // 실시간 활성 사용자 조회 (active_users_view 사용)
    const { data: activeUsers, error: activeError } = await db
      .from('active_users_view')
      .select('*')
      .limit(limit)

    if (activeError) {
      console.error('활성 사용자 조회 오류:', activeError)
      throw ApiError.internalServerError('활성 사용자 데이터 조회에 실패했습니다.')
    }

    let recentActivity = []
    if (includeActivity) {
      // 최근 활동 피드 조회
      const { data: activityData, error: activityError } = await db.rpc(
        'get_real_time_activity_feed',
        {
          p_limit: 30,
        }
      )

      if (activityError) {
        console.error('활동 피드 조회 오류:', activityError)
      } else {
        recentActivity = activityData || []
      }
    }

    // 간단한 통계 정보
    const activeCount = activeUsers?.length || 0
    const totalSessions = activeCount

    // 세션 시간대별 분비
    const sessionsByTime =
      activeUsers?.reduce((acc: Record<string, number>, user: any) => {
        const hour = new Date(user.last_activity).getHours()
        const timeSlot = `${hour}:00-${hour + 1}:00`
        acc[timeSlot] = (acc[timeSlot] || 0) + 1
        return acc
      }, {}) || {}

    return ApiSuccess.ok({
      activeUsers: activeUsers || [],
      recentActivity,
      statistics: {
        활성사용자수: activeCount,
        총세션수: totalSessions,
        시간대별세션수: sessionsByTime,
        평균세션시간:
          activeUsers?.reduce((sum: number, user: any) => {
            return sum + (user.minutes_since_activity || 0)
          }, 0) / Math.max(activeCount, 1),
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        refreshInterval: 30, // 초
        includeActivity,
      },
    })
  },
})
