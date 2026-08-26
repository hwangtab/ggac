import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { parseIntegerParam } from '@/utils/queryParams'
import { validateUUID } from '@/utils/validation'
import { listActivities, getUserActivityStats } from '@/db/queries/activities'
import { listSessions } from '@/db/queries/sessions'

/**
 * 활동 패턴 분석 API
 * GET /api/admin/analytics/patterns
 */
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/analytics/patterns',
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
    const days = parseIntegerParam(searchParams.get('days'), 30, { min: 1, max: 365 })
    const analysisType = searchParams.get('type') || 'activity_patterns'
    const excludeTest = searchParams.get('exclude_test') !== 'false' // 기본 true

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    let analysisResult: any = {}

    switch (analysisType) {
      case 'activity_patterns':
        // 활동 패턴 분석
        analysisResult = await analyzeActivityPatterns(sanitizedUserId, startDate, excludeTest)
        break

      case 'user_behavior':
        // 사용자 행동 분석
        analysisResult = await analyzeUserBehavior(sanitizedUserId, startDate)
        break

      case 'session_analysis':
        // 세션 분석
        analysisResult = await analyzeSessionPatterns(sanitizedUserId, startDate)
        break

      case 'content_engagement':
        // 콘텐츠 참여도 분석
        analysisResult = await analyzeContentEngagement(sanitizedUserId, startDate)
        break

      default:
        return ApiError.badRequest('지원되지 않는 분석 유형입니다.').toNextResponse()
    }

    return ApiSuccess.ok({
      analysisType,
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      userId: sanitizedUserId,
      ...analysisResult,
      metadata: {
        generatedAt: new Date().toISOString(),
        version: '1.0',
      },
    })
  },
})

/**
 * 활동 패턴 분석
 */
async function analyzeActivityPatterns(
  userId: string | null,
  startDate: Date,
  excludeTest: boolean
) {
  // 시간대별 활동 분석 — 단계 4: 수동 Supabase 쿼리를 Turso 쿼리 계층
  // (listActivities)으로 대체했다. excludeTest 옵션(metadata.generated===true
  // 제외)도 그대로 옮겼다.
  const hourlyActivity = await listActivities({
    userId,
    startDate,
    excludeGeneratedMetadata: excludeTest,
  })

  const hourlyDistribution =
    hourlyActivity?.reduce((acc: Record<number, number>, activity: any) => {
      const hour = new Date(activity.created_at).getHours()
      acc[hour] = (acc[hour] || 0) + 1
      return acc
    }, {}) || {}

  // 요일별 활동 분석
  const dayOfWeekDistribution =
    hourlyActivity?.reduce((acc: Record<number, number>, activity: any) => {
      const dayOfWeek = new Date(activity.created_at).getDay()
      acc[dayOfWeek] = (acc[dayOfWeek] || 0) + 1
      return acc
    }, {}) || {}

  // 활동 유형별 분석
  const actionTypeDistribution =
    hourlyActivity?.reduce((acc: Record<string, number>, activity: any) => {
      acc[activity.action_type] = (acc[activity.action_type] || 0) + 1
      return acc
    }, {}) || {}

  // 데이터 품질 분석 (실제 vs 테스트 데이터 구분)
  let realDataCount = 0
  let testDataCount = 0

  hourlyActivity?.forEach((activity: any) => {
    // metadata가 있고 generated가 true인 경우 테스트 데이터
    if (activity.metadata && activity.metadata.generated === true) {
      testDataCount++
    } else {
      realDataCount++
    }
  })

  const dataSource = testDataCount === 0 ? 'real' : realDataCount === 0 ? 'test' : 'mixed'

  return {
    activityPatterns: {
      hourlyDistribution,
      dayOfWeekDistribution,
      actionTypeDistribution,
      peakHour: Object.entries(hourlyDistribution).reduce(
        (a, b) => (hourlyDistribution[a[0] as any] > hourlyDistribution[b[0] as any] ? a : b),
        ['0', 0]
      )[0],
      totalActivities: hourlyActivity?.length || 0,
      dataQuality: {
        realDataCount,
        testDataCount,
        dataSource,
      },
    },
  }
}

/**
 * 사용자 행동 분석
 */
async function analyzeUserBehavior(userId: string | null, startDate: Date) {
  // 사용자 통계 조회 — 단계 4: get_user_activity_stats RPC를 Turso 쿼리
  // 계층(getUserActivityStats)으로 대체했다.
  const userStats = await getUserActivityStats({
    userId,
    startDate,
    endDate: new Date(),
  })

  // 사용자 세션 통계 — 단계 4: 수동 Supabase 쿼리를 Turso 쿼리 계층
  // (listSessions)으로 대체했다.
  const sessions = await listSessions({ userId, loginAfter: startDate })

  const sessionStats = sessions?.reduce(
    (acc: any, session: any) => {
      const loginTime = new Date(session.login_at)
      const logoutTime = session.logout_at ? new Date(session.logout_at) : new Date()
      const duration = Math.round((logoutTime.getTime() - loginTime.getTime()) / 60000) // 분 단위

      acc.totalSessions += 1
      acc.totalDuration += duration
      acc.averageDuration = acc.totalDuration / acc.totalSessions

      if (duration > acc.longestSession) {
        acc.longestSession = duration
      }

      return acc
    },
    {
      totalSessions: 0,
      totalDuration: 0,
      averageDuration: 0,
      longestSession: 0,
    }
  ) || { totalSessions: 0, totalDuration: 0, averageDuration: 0, longestSession: 0 }

  return {
    userBehavior: {
      activityStats: userStats || [],
      sessionStats,
      engagementScore: calculateEngagementScore(userStats, sessionStats),
    },
  }
}

/**
 * 세션 패턴 분석
 */
async function analyzeSessionPatterns(userId: string | null, startDate: Date) {
  // 단계 4: 수동 Supabase 쿼리를 Turso 쿼리 계층(listSessions)으로 대체했다.
  const sessions = await listSessions({ userId, loginAfter: startDate })

  // 세션 길이 분석
  const sessionDurations =
    sessions?.map((session: any) => {
      const loginTime = new Date(session.login_at)
      const logoutTime = session.logout_at ? new Date(session.logout_at) : new Date()
      return Math.round((logoutTime.getTime() - loginTime.getTime()) / 60000)
    }) || []

  const sessionLengthDistribution = sessionDurations.reduce(
    (acc: Record<string, number>, duration: number) => {
      const bucket =
        duration < 5
          ? '0-5분'
          : duration < 15
            ? '5-15분'
            : duration < 30
              ? '15-30분'
              : duration < 60
                ? '30-60분'
                : '60분+'
      acc[bucket] = (acc[bucket] || 0) + 1
      return acc
    },
    {}
  )

  return {
    sessionPatterns: {
      sessionLengthDistribution,
      averageSessionLength:
        sessionDurations.reduce((a: number, b: number) => a + b, 0) /
        Math.max(sessionDurations.length, 1),
      totalSessions: sessions?.length || 0,
      activeSessions: sessions?.filter((s: any) => s.is_active).length || 0,
    },
  }
}

/**
 * 콘텐츠 참여도 분석
 */
async function analyzeContentEngagement(userId: string | null, startDate: Date) {
  // 게시글 관련 활동 — 단계 4: 수동 Supabase 쿼리를 Turso 쿼리 계층
  // (listActivities)으로 대체했다.
  const postActivities = await listActivities({
    userId,
    startDate,
    actionTypes: ['post_created', 'post_updated', 'comment_created', 'like_added'],
  })

  const engagementStats =
    postActivities?.reduce((acc: any, activity: any) => {
      acc[activity.action_type] = (acc[activity.action_type] || 0) + 1
      return acc
    }, {}) || {}

  return {
    contentEngagement: {
      postCreated: engagementStats.post_created || 0,
      postUpdated: engagementStats.post_updated || 0,
      commentsCreated: engagementStats.comment_created || 0,
      likesGiven: engagementStats.like_added || 0,
      totalEngagements: Object.values(engagementStats).reduce((a: any, b: any) => a + b, 0),
    },
  }
}

/**
 * 참여도 점수 계산
 */
function calculateEngagementScore(activityStats: any[], sessionStats: any): number {
  const totalActivities =
    activityStats?.reduce((sum, stat) => sum + (stat.total_count || 0), 0) || 0
  const avgSessionLength = sessionStats.averageDuration || 0
  const sessionCount = sessionStats.totalSessions || 0

  // 0-100 점수로 정규화
  const activityScore = Math.min(totalActivities * 2, 50) // 최대 50점
  const sessionScore = Math.min((avgSessionLength / 30) * 25, 25) // 최대 25점 (30분 기준)
  const frequencyScore = Math.min(sessionCount * 5, 25) // 최대 25점

  return Math.round(activityScore + sessionScore + frequencyScore)
}
