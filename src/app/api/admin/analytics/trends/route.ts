import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { withRateLimit } from '@/utils/rateLimit'
import { requireAdmin } from '@/lib/server/adminAuth'

/**
 * 트렌드 분석 API
 * GET /api/admin/analytics/trends
 */
export async function GET(request: NextRequest) {
  return withRateLimit('ADMIN_API')(async () => {
    try {
      const auth = await requireAdmin()
      if (auth instanceof NextResponse) return auth
      const { db } = auth

      const { searchParams } = new URL(request.url)
      const period = searchParams.get('period') || 'daily' // daily, weekly, monthly
      const weeks = parseInt(searchParams.get('weeks') || '8')
      const trendType = searchParams.get('type') || 'activity' // activity, users, engagement

      let trendData: any = {}

      switch (trendType) {
        case 'activity':
          trendData = await getActivityTrends(db, period, weeks)
          break

        case 'users':
          trendData = await getUserTrends(db, period, weeks)
          break

        case 'engagement':
          trendData = await getEngagementTrends(db, period, weeks)
          break

        case 'performance':
          trendData = await getPerformanceTrends(db, period, weeks)
          break

        default:
          return createErrorResponse(
            { success: false, error: '지원되지 않는 트렌드 유형입니다.' },
            400
          )
      }

      return NextResponse.json({
        trendType,
        period,
        weeks,
        ...trendData,
        metadata: {
          generatedAt: new Date().toISOString(),
          dataPoints: trendData.series?.length || 0,
        },
      })
    } catch (error) {
      console.error('트렌드 분석 API 오류:', error)
      return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
    }
  })(request)
}

/**
 * 활동 트렌드 분석
 */
async function getActivityTrends(supabase: any, period: string, weeks: number) {
  // 주간 활동 통계 사용
  const { data: weeklyStats } = await supabase
    .from('weekly_activity_stats')
    .select('*')
    .order('week_start', { ascending: true })
    .limit(weeks)

  const series =
    weeklyStats?.map((week: any) => ({
      date: week.week_start,
      value: week.total_count,
      unique_users: week.unique_users,
      action_type: week.action_type,
    })) || []
  // 데이터가 없으면 그대로 빈 배열 반환(가짜 데이터 생성 안 함)

  // 액션 타입별 그룹화
  const actionTypeGroups = series.reduce((acc: Record<string, any[]>, item: any) => {
    if (!acc[item.action_type]) {
      acc[item.action_type] = []
    }
    acc[item.action_type].push(item)
    return acc
  }, {})

  // 전체 트렌드 계산
  const totalTrend =
    series.length > 0 ? calculateTrendDirection(series.map((s: any) => s.value)) : 'flat'

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
async function getUserTrends(supabase: any, period: string, weeks: number) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)

  // 주별 신규 등록 사용자
  const { data: newUsers } = await supabase
    .from('member_profiles')
    .select('created_at')
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true })

  // 주별 활성 사용자 (세션 기반)
  const { data: activeSessions } = await supabase
    .from('user_sessions')
    .select('login_at, user_id')
    .gte('login_at', startDate.toISOString())
    .order('login_at', { ascending: true })

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
async function getEngagementTrends(supabase: any, period: string, weeks: number) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)

  // 참여도 관련 활동
  const engagementActions = ['post_created', 'comment_created', 'like_added', 'post_updated']

  const { data: engagementData } = await supabase
    .from('user_activities')
    .select('created_at, action_type, user_id')
    .gte('created_at', startDate.toISOString())
    .in('action_type', engagementActions)
    .order('created_at', { ascending: true })

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
async function getPerformanceTrends(supabase: any, period: string, weeks: number) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)

  // 세션 성능 데이터
  const { data: sessions } = await supabase
    .from('user_sessions')
    .select('login_at, logout_at, last_activity')
    .gte('login_at', startDate.toISOString())
    .order('login_at', { ascending: true })

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
