import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/utils/rateLimiter'

/**
 * 멤버 리포트 생성 API
 * POST /api/admin/reports/generate
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit(RATE_LIMIT_CONFIGS.ADMIN_API)
    const rateLimitResult = rateLimiter(request)
    
    if (!rateLimitResult.success) {
      return rateLimitResult.response!
    }

    const supabase = createRouteHandlerClient({ cookies })

    // 인증 확인
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 관리자 권한 확인
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status')
      .eq('id', session.user.id)
      .single()

    if (!profile?.is_admin || profile.registration_status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { reportType, dateRange, filters } = body

    // 리포트 유형별 데이터 생성
    let reportData
    const startDate = dateRange?.start ? new Date(dateRange.start) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate = dateRange?.end ? new Date(dateRange.end) : new Date()

    switch (reportType) {
      case 'member_activity':
        reportData = await generateMemberActivityReport(supabase, startDate, endDate, filters)
        break
      case 'post_engagement':
        reportData = await generatePostEngagementReport(supabase, startDate, endDate, filters)
        break
      case 'user_registration':
        reportData = await generateUserRegistrationReport(supabase, startDate, endDate, filters)
        break
      case 'comprehensive':
        reportData = await generateComprehensiveReport(supabase, startDate, endDate, filters)
        break
      default:
        return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
    }

    // 리포트 메타데이터 생성
    const reportMetadata = {
      id: `report_${Date.now()}`,
      type: reportType,
      generatedAt: new Date().toISOString(),
      generatedBy: session.user.id,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      filters,
      summary: reportData.summary
    }

    return NextResponse.json({
      success: true,
      report: {
        metadata: reportMetadata,
        data: reportData.data
      }
    })

  } catch (error) {
    console.error('Report generation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// 멤버 활동 리포트 생성
async function generateMemberActivityReport(supabase: any, startDate: Date, endDate: Date, filters: any) {
  // 기간별 활동 통계
  const { data: activities } = await supabase
    .from('user_activities')
    .select(`
      id,
      user_id,
      action_type,
      created_at,
      member_profiles!inner(display_name, email, registration_status)
    `)
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  // 활동별 집계
  const activitySummary = activities?.reduce((acc: any, activity: any) => {
    const actionType = activity.action_type
    acc[actionType] = (acc[actionType] || 0) + 1
    return acc
  }, {}) || {}

  // 사용자별 활동 집계
  const userActivityMap = activities?.reduce((acc: any, activity: any) => {
    const userId = activity.user_id
    if (!acc[userId]) {
      acc[userId] = {
        userId,
        displayName: activity.member_profiles.display_name,
        email: activity.member_profiles.email,
        totalActivities: 0,
        activities: {}
      }
    }
    acc[userId].totalActivities++
    acc[userId].activities[activity.action_type] = (acc[userId].activities[activity.action_type] || 0) + 1
    return acc
  }, {}) || {}

  const userActivities = Object.values(userActivityMap)
    .sort((a: any, b: any) => b.totalActivities - a.totalActivities)

  return {
    summary: {
      totalActivities: activities?.length || 0,
      uniqueUsers: Object.keys(userActivityMap).length,
      topActivity: Object.entries(activitySummary).sort(([,a]: any, [,b]: any) => b - a)[0]?.[0] || 'none',
      averageActivitiesPerUser: userActivities.length > 0 ? 
        Math.round((activities?.length || 0) / userActivities.length * 100) / 100 : 0
    },
    data: {
      activitySummary,
      userActivities: userActivities.slice(0, 50), // 상위 50명만
      dailyActivities: await getDailyActivityBreakdown(supabase, startDate, endDate)
    }
  }
}

// 게시글 참여도 리포트 생성
async function generatePostEngagementReport(supabase: any, startDate: Date, endDate: Date, filters: any) {
  // 게시글 통계
  const { data: posts } = await supabase
    .from('posts')
    .select(`
      id,
      title,
      category,
      created_at,
      views,
      likes,
      is_pinned,
      member_profiles!inner(display_name)
    `)
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())
    .order('views', { ascending: false })

  // 댓글 통계
  const { data: comments } = await supabase
    .from('comments')
    .select('id, post_id, created_at')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  // 게시글별 댓글 수 계산
  const commentsByPost = comments?.reduce((acc: any, comment: any) => {
    acc[comment.post_id] = (acc[comment.post_id] || 0) + 1
    return acc
  }, {}) || {}

  // 카테고리별 분석
  const categoryStats = posts?.reduce((acc: any, post: any) => {
    const category = post.category
    if (!acc[category]) {
      acc[category] = { count: 0, totalViews: 0, totalLikes: 0, totalComments: 0 }
    }
    acc[category].count++
    acc[category].totalViews += post.views || 0
    acc[category].totalLikes += post.likes || 0
    acc[category].totalComments += commentsByPost[post.id] || 0
    return acc
  }, {}) || {}

  return {
    summary: {
      totalPosts: posts?.length || 0,
      totalComments: comments?.length || 0,
      totalViews: posts?.reduce((sum: number, post: any) => sum + (post.views || 0), 0) || 0,
      totalLikes: posts?.reduce((sum: number, post: any) => sum + (post.likes || 0), 0) || 0,
      averageEngagement: posts?.length > 0 ? 
        Math.round(((comments?.length || 0) + (posts?.reduce((sum: number, post: any) => sum + (post.likes || 0), 0) || 0)) / posts.length * 100) / 100 : 0
    },
    data: {
      topPosts: posts?.slice(0, 10).map((post: any) => ({
        ...post,
        commentCount: commentsByPost[post.id] || 0
      })) || [],
      categoryStats,
      engagementTrends: await getEngagementTrends(supabase, startDate, endDate)
    }
  }
}

// 사용자 등록 리포트 생성
async function generateUserRegistrationReport(supabase: any, startDate: Date, endDate: Date, filters: any) {
  const { data: registrations } = await supabase
    .from('member_profiles')
    .select('id, display_name, email, registration_status, is_artist, created_at')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  const statusStats = registrations?.reduce((acc: any, user: any) => {
    acc[user.registration_status] = (acc[user.registration_status] || 0) + 1
    return acc
  }, {}) || {}

  return {
    summary: {
      totalRegistrations: registrations?.length || 0,
      approvedCount: statusStats.approved || 0,
      pendingCount: statusStats.pending || 0,
      rejectedCount: statusStats.rejected || 0,
      artistCount: registrations?.filter((u: any) => u.is_artist).length || 0
    },
    data: {
      statusStats,
      dailyRegistrations: await getDailyRegistrationBreakdown(supabase, startDate, endDate),
      recentRegistrations: registrations?.slice(0, 20) || []
    }
  }
}

// 종합 리포트 생성
async function generateComprehensiveReport(supabase: any, startDate: Date, endDate: Date, filters: any) {
  const [memberActivity, postEngagement, userRegistration] = await Promise.all([
    generateMemberActivityReport(supabase, startDate, endDate, filters),
    generatePostEngagementReport(supabase, startDate, endDate, filters),
    generateUserRegistrationReport(supabase, startDate, endDate, filters)
  ])

  return {
    summary: {
      ...memberActivity.summary,
      ...postEngagement.summary,
      ...userRegistration.summary,
      systemHealth: 'good' // 추후 시스템 상태 로직 추가
    },
    data: {
      memberActivity: memberActivity.data,
      postEngagement: postEngagement.data,
      userRegistration: userRegistration.data
    }
  }
}

// 일별 활동 분석
async function getDailyActivityBreakdown(supabase: any, startDate: Date, endDate: Date) {
  const { data } = await supabase
    .from('daily_activity_stats')
    .select('activity_date, action_type, count')
    .gte('activity_date', startDate.toISOString().split('T')[0])
    .lte('activity_date', endDate.toISOString().split('T')[0])
    .order('activity_date', { ascending: true })

  return data || []
}

// 참여도 트렌드 분석
async function getEngagementTrends(supabase: any, startDate: Date, endDate: Date) {
  // 주간 집계로 트렌드 분석
  const { data } = await supabase
    .from('weekly_activity_stats')
    .select('week_start, action_type, total_count, unique_users')
    .gte('week_start', startDate.toISOString())
    .lte('week_start', endDate.toISOString())
    .order('week_start', { ascending: true })

  return data || []
}

// 일별 등록 분석
async function getDailyRegistrationBreakdown(supabase: any, startDate: Date, endDate: Date) {
  const { data } = await supabase
    .from('member_profiles')
    .select('created_at, registration_status')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  // 일별로 그룹화
  const dailyStats = data?.reduce((acc: any, profile: any) => {
    const date = profile.created_at.split('T')[0]
    if (!acc[date]) {
      acc[date] = { date, total: 0, approved: 0, pending: 0, rejected: 0 }
    }
    acc[date].total++
    acc[date][profile.registration_status]++
    return acc
  }, {}) || {}

  return Object.values(dailyStats).sort((a: any, b: any) => a.date.localeCompare(b.date))
}