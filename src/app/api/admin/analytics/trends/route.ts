import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { parseIntegerParam } from '@/utils/queryParams'
import { parseTrendPeriod, parseTrendType } from '@/constants/adminAnalytics'
import type { TrendPeriod } from '@/constants/adminAnalytics'
import { listProfileSignupsSince } from '@/db/queries/profiles'
import { getWeeklyActivityStats, listActivities } from '@/db/queries/activities'
import { listSessions } from '@/db/queries/sessions'

type ActivityTrendPoint = {
  date: string
  value: number
  unique_users: number
  action_type?: string
}

/**
 * 트렌드 분석 API
 * GET /api/admin/analytics/trends
 */
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/analytics/trends',
  rateLimit: RATE_LIMITS.ADMIN_API,
  auth: 'admin',
  errorMessage: '서버 오류가 발생했습니다.',
  handler: async ({ request }) => {
    const { searchParams } = new URL(request.url)
    const periodParam = searchParams.get('period') || 'daily'
    const period = parseTrendPeriod(periodParam)
    const weeks = parseIntegerParam(searchParams.get('weeks'), 8, { min: 1, max: 104 })
    const trendTypeParam = searchParams.get('type') || 'activity'
    const trendType = parseTrendType(trendTypeParam)

    if (!period) {
      return ApiError.badRequest('지원되지 않는 기간 유형입니다.').toNextResponse()
    }
    if (!trendType) {
      return ApiError.badRequest('지원되지 않는 트렌드 유형입니다.').toNextResponse()
    }

    let trendData: any = {}

    switch (trendType) {
      case 'activity':
        trendData = await getActivityTrends(period, weeks)
        break

      case 'users':
        trendData = await getUserTrends(period, weeks)
        break

      case 'engagement':
        trendData = await getEngagementTrends(period, weeks)
        break

      case 'performance':
        trendData = await getPerformanceTrends(period, weeks)
        break

      default: {
        const exhaustiveCheck: never = trendType
        return exhaustiveCheck
      }
    }

    return ApiSuccess.ok({
      trendType,
      period,
      weeks,
      ...trendData,
      metadata: {
        generatedAt: new Date().toISOString(),
        dataPoints: trendData.series?.length || 0,
      },
    })
  },
})

/**
 * 활동 트렌드 분석
 */
async function getActivityTrends(period: TrendPeriod, weeks: number) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)
  startDate.setHours(0, 0, 0, 0)

  // 최근 기간의 전체 주간 활동 통계 사용 — 단계 4: weekly_activity_stats 뷰를
  // Turso 쿼리 계층(getWeeklyActivityStats)으로 대체했다. 뷰가 원래도
  // "최근 8주"로 고정된 창이었으므로(원본 SQL 참고), 이 조회 자체가 요청한
  // `weeks`(최대 104)를 항상 채우지는 못할 수 있다 — 원본과 동일한 제약이다.
  const allWeeklyStats = await getWeeklyActivityStats()
  const weeklyStats = allWeeklyStats
    .filter(week => week.week_start >= startDate.toISOString())
    .sort((a, b) => a.week_start.localeCompare(b.week_start))

  const rawSeries: ActivityTrendPoint[] =
    weeklyStats?.map((week: any) => ({
      date: week.week_start,
      value: week.total_count,
      unique_users: week.unique_users,
      action_type: week.action_type,
    })) || []

  const weeklyTotals = rawSeries.reduce<Record<string, ActivityTrendPoint>>((acc, item) => {
    if (!acc[item.date]) {
      acc[item.date] = {
        date: item.date,
        value: 0,
        unique_users: 0,
      }
    }

    acc[item.date].value += item.value
    acc[item.date].unique_users = Math.max(acc[item.date].unique_users, item.unique_users || 0)
    return acc
  }, {})

  const series: ActivityTrendPoint[] = Object.values(weeklyTotals).slice(-weeks)
  // 데이터가 없으면 그대로 빈 배열 반환(가짜 데이터 생성 안 함)

  // 액션 타입별 그룹화
  const actionTypeGroups = rawSeries.reduce((acc: Record<string, any[]>, item: any) => {
    if (!acc[item.action_type]) {
      acc[item.action_type] = []
    }
    acc[item.action_type].push(item)
    return acc
  }, {})

  // 전체 트렌드 계산
  const totalTrend =
    series.length > 0
      ? calculateTrendDirection(series.map((s: any) => s.value))
      : { direction: 'stable' as const, percentage: 0, change: 0 }

  return {
    series,
    actionTypeGroups,
    trends: {
      overall: totalTrend,
      byActionType: Object.keys(actionTypeGroups).reduce(
        (acc: Record<string, any>, actionType: string) => {
          acc[actionType] = calculateTrendDirection(
            actionTypeGroups[actionType].map((item: any) => item.value)
          )
          return acc
        },
        {}
      ),
    },
    summary: {
      totalActivities: series.reduce((sum: number, item: any) => sum + item.value, 0),
      averageWeeklyActivities:
        series.length > 0
          ? series.reduce((sum: number, item: any) => sum + item.value, 0) / series.length
          : 0,
      peakWeek:
        series.length > 0
          ? series.reduce((max: any, item: any) => (item.value > (max?.value || 0) ? item : max))
          : null,
    },
  }
}

/**
 * 사용자 트렌드 분석
 */
async function getUserTrends(period: TrendPeriod, weeks: number) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)

  // 주별 신규 등록 사용자 — member_profiles는 Turso가 권위(단계 3c 이후)라
  // listProfileSignupsSince(Turso)를 쓴다. user_sessions도 단계 4에서 Turso
  // 권위가 되어 listSessions(Turso)로 옮겼다 — 이 함수는 더 이상 두 DB를
  // 함께 읽지 않는다.
  const newUsers = await listProfileSignupsSince(startDate)

  // 주별 활성 사용자 (세션 기반)
  const activeSessions = await listSessions({ loginAfter: startDate })

  // 주별 데이터 그룹화
  const weeklyData = []
  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(startDate)
    weekStart.setDate(weekStart.getDate() + i * 7)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const newUsersThisWeek =
      newUsers?.filter((user: any) => {
        const userDate = new Date(user.created_at)
        return userDate >= weekStart && userDate < weekEnd
      }).length || 0

    const activeUsersThisWeek = new Set(
      activeSessions
        ?.filter((session: any) => {
          const sessionDate = new Date(session.login_at)
          return sessionDate >= weekStart && sessionDate < weekEnd
        })
        .map((session: any) => session.user_id) || []
    ).size

    weeklyData.push({
      week: weekStart.toISOString().split('T')[0],
      newUsers: newUsersThisWeek,
      activeUsers: activeUsersThisWeek,
    })
  }

  return {
    series: weeklyData,
    trends: {
      newUsers: calculateTrendDirection(weeklyData.map(w => w.newUsers)),
      activeUsers: calculateTrendDirection(weeklyData.map(w => w.activeUsers)),
    },
    summary: {
      totalNewUsers: weeklyData.reduce((sum, week) => sum + week.newUsers, 0),
      averageActiveUsers: weeklyData.reduce((sum, week) => sum + week.activeUsers, 0) / weeks,
      peakActiveWeek:
        weeklyData.length > 0
          ? weeklyData.reduce((max, week) =>
              week.activeUsers > (max?.activeUsers || 0) ? week : max
            )
          : null,
    },
  }
}

/**
 * 참여도 트렌드 분석
 */
async function getEngagementTrends(period: TrendPeriod, weeks: number) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)

  // 참여도 관련 활동 — 단계 4: 수동 Supabase 쿼리를 Turso 쿼리 계층
  // (listActivities)으로 대체했다.
  const engagementActions: Array<
    'post_created' | 'comment_created' | 'like_added' | 'post_updated'
  > = ['post_created', 'comment_created', 'like_added', 'post_updated']

  const engagementData = await listActivities({
    startDate,
    actionTypes: engagementActions,
  })

  // 주별 참여도 데이터 계산
  const weeklyEngagement = []
  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(startDate)
    weekStart.setDate(weekStart.getDate() + i * 7)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const weekActivities =
      engagementData?.filter((activity: any) => {
        const activityDate = new Date(activity.created_at)
        return activityDate >= weekStart && activityDate < weekEnd
      }) || []

    const engagementStats = weekActivities.reduce((acc: Record<string, number>, activity: any) => {
      acc[activity.action_type] = (acc[activity.action_type] || 0) + 1
      return acc
    }, {})

    const uniqueEngagedUsers = new Set(weekActivities.map((a: any) => a.user_id)).size

    weeklyEngagement.push({
      week: weekStart.toISOString().split('T')[0],
      ...engagementStats,
      totalEngagements: Object.values(engagementStats).reduce((a: any, b: any) => a + b, 0),
      uniqueUsers: uniqueEngagedUsers,
    })
  }

  return {
    series: weeklyEngagement,
    trends: {
      totalEngagements: calculateTrendDirection(weeklyEngagement.map(w => w.totalEngagements)),
      uniqueUsers: calculateTrendDirection(weeklyEngagement.map(w => w.uniqueUsers)),
    },
    summary: {
      totalEngagements: weeklyEngagement.reduce(
        (sum, week) => sum + (week.totalEngagements || 0),
        0
      ),
      averageWeeklyEngagements:
        weeklyEngagement.reduce((sum, week) => sum + (week.totalEngagements || 0), 0) / weeks,
      mostEngagedWeek:
        weeklyEngagement.length > 0
          ? weeklyEngagement.reduce((max, week) =>
              (week.totalEngagements || 0) > (max?.totalEngagements || 0) ? week : max
            )
          : null,
    },
  }
}

/**
 * 성능 트렌드 분석
 */
async function getPerformanceTrends(period: TrendPeriod, weeks: number) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)

  // 세션 성능 데이터 — 단계 4: 수동 Supabase 쿼리를 Turso 쿼리 계층
  // (listSessions)으로 대체했다.
  const sessions = await listSessions({ loginAfter: startDate })

  const weeklyPerformance = []
  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(startDate)
    weekStart.setDate(weekStart.getDate() + i * 7)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const weekSessions =
      sessions?.filter((session: any) => {
        const sessionDate = new Date(session.login_at)
        return sessionDate >= weekStart && sessionDate < weekEnd
      }) || []

    const sessionDurations = weekSessions.map((session: any) => {
      const loginTime = new Date(session.login_at)
      const logoutTime = session.logout_at
        ? new Date(session.logout_at)
        : new Date(session.last_activity)
      return Math.max(0, Math.round((logoutTime.getTime() - loginTime.getTime()) / 60000)) // 분 단위
    })

    const avgSessionDuration =
      sessionDurations.reduce((sum: number, duration: number) => sum + duration, 0) /
      Math.max(sessionDurations.length, 1)
    const totalSessions = weekSessions.length

    weeklyPerformance.push({
      week: weekStart.toISOString().split('T')[0],
      totalSessions,
      avgSessionDuration: Math.round(avgSessionDuration),
      totalSessionTime: sessionDurations.reduce(
        (sum: number, duration: number) => sum + duration,
        0
      ),
    })
  }

  return {
    series: weeklyPerformance,
    trends: {
      sessions: calculateTrendDirection(weeklyPerformance.map(w => w.totalSessions)),
      sessionDuration: calculateTrendDirection(weeklyPerformance.map(w => w.avgSessionDuration)),
    },
    summary: {
      totalSessions: weeklyPerformance.reduce((sum, week) => sum + week.totalSessions, 0),
      overallAvgDuration:
        weeklyPerformance.reduce((sum, week) => sum + week.avgSessionDuration, 0) / weeks,
    },
  }
}

/**
 * 트렌드 방향 계산
 */
function calculateTrendDirection(values: number[]): {
  direction: 'up' | 'down' | 'stable'
  percentage: number
  change: number
} {
  if (values.length < 2) {
    return { direction: 'stable', percentage: 0, change: 0 }
  }

  const firstHalf = values.slice(0, Math.floor(values.length / 2))
  const secondHalf = values.slice(Math.floor(values.length / 2))

  const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length

  const change = secondAvg - firstAvg
  const percentage = firstAvg === 0 ? 0 : Math.round((change / firstAvg) * 100)

  let direction: 'up' | 'down' | 'stable' = 'stable'
  if (Math.abs(percentage) > 5) {
    // 5% 이상 변화를 의미있는 트렌드로 간주
    direction = change > 0 ? 'up' : 'down'
  }

  return { direction, percentage, change: Math.round(change) }
}
