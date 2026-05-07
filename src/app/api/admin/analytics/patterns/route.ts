import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { withRateLimit } from '@/utils/rateLimit'
import { requireAdmin } from '@/lib/server/adminAuth'

/**
 * 활동 패턴 분석 API
 * GET /api/admin/analytics/patterns
 */
export async function GET(request: NextRequest) {
  return withRateLimit('ADMIN_API')(async () => {
    try {
      const auth = await requireAdmin()
      if (auth instanceof NextResponse) return auth
      const { db } = auth

      const { searchParams } = new URL(request.url)
      const userId = searchParams.get('user_id')
      const days = parseInt(searchParams.get('days') || '30')
      const analysisType = searchParams.get('type') || 'activity_patterns'
      const excludeTest = searchParams.get('exclude_test') !== 'false' // 기본 true

      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      let analysisResult: any = {}

      switch (analysisType) {
        case 'activity_patterns':
          // 활동 패턴 분석
          analysisResult = await analyzeActivityPatterns(db, userId, startDate, excludeTest)
          break

        case 'user_behavior':
          // 사용자 행동 분석
          analysisResult = await analyzeUserBehavior(db, userId, startDate)
          break

        case 'session_analysis':
          // 세션 분석
          analysisResult = await analyzeSessionPatterns(db, userId, startDate)
          break

        case 'content_engagement':
          // 콘텐츠 참여도 분석
          analysisResult = await analyzeContentEngagement(db, userId, startDate)
          break

        default:
          return createErrorResponse(
            { success: false, error: '지원되지 않는 분석 유형입니다.' },
            400
          )
      }

      return NextResponse.json({
        analysisType,
        period: {
          days,
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
        },
        userId,
        ...analysisResult,
        metadata: {
          generatedAt: new Date().toISOString(),
          version: '1.0',
        },
      })
    } catch (error) {
      console.error('패턴 분석 API 오류:', error)
      return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
    }
  })(request)
}

/**
 * 활동 패턴 분석
 */
async function analyzeActivityPatterns(
  supabase: any,
  userId: string | null,
  startDate: Date,
  excludeTest: boolean
) {
  // 시간대별 활동 분석
  let query = supabase
    .from('user_activities')
    .select('created_at, action_type, metadata')
    .gte('created_at', startDate.toISOString())

  // userId가 있을 때만 user_id 필터 적용
  if (userId) {
    query = query.eq('user_id', userId)
  }

  // 테스트 데이터 제외 옵션: metadata.generated !== true
  if (excludeTest) {
    // PostgREST JSONB field filter
    query = query.filter('metadata->>generated', 'neq', 'true') as any
  }

  const { data: hourlyActivity } = await query

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
async function analyzeUserBehavior(supabase: any, userId: string | null, startDate: Date) {
  // 사용자 통계 조회
  const { data: userStats } = await supabase.rpc('get_user_activity_stats', {
    p_user_id: userId,
    p_start_date: startDate.toISOString().split('T')[0],
    p_end_date: new Date().toISOString().split('T')[0],
  })

  // 사용자 세션 통계
  let query = supabase.from('user_sessions').select('*').gte('login_at', startDate.toISOString())

  if (userId) {
    query = query.eq('user_id', userId)
  }

  const { data: sessions } = await query

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
async function analyzeSessionPatterns(supabase: any, userId: string | null, startDate: Date) {
  let query = supabase.from('user_sessions').select('*').gte('login_at', startDate.toISOString())

  if (userId) {
    query = query.eq('user_id', userId)
  }

  const { data: sessions } = await query

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
async function analyzeContentEngagement(supabase: any, userId: string | null, startDate: Date) {
  // 게시글 관련 활동
  let postQuery = supabase
    .from('user_activities')
    .select('*')
    .gte('created_at', startDate.toISOString())
    .in('action_type', ['post_created', 'post_updated', 'comment_created', 'like_added'])

  if (userId) {
    postQuery = postQuery.eq('user_id', userId)
  }

  const { data: postActivities } = await postQuery

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
