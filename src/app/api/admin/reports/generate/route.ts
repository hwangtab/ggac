import { NextRequest, NextResponse } from 'next/server'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
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

    const cookieStore = await cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore as any })

    // 인증 확인
    const {
      data: { session },
    } = await supabase.auth.getSession()
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

    // Service Role 클라이언트 생성 (RLS 우회용)
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.')
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const serviceSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // 리포트 유형별 데이터 생성 (Service Role 클라이언트 사용)
    let reportData
    const startDate = dateRange?.start
      ? new Date(dateRange.start)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate = dateRange?.end ? new Date(dateRange.end) : new Date()

    // 날짜 범위 정확성 보장: 시작일은 00:00:00, 종료일은 23:59:59.999로 설정
    startDate.setHours(0, 0, 0, 0)
    endDate.setHours(23, 59, 59, 999)

    console.log(
      `리포트 생성 시작 - 타입: ${reportType}, 기간: ${startDate.toISOString()} ~ ${endDate.toISOString()}`
    )

    switch (reportType) {
      case 'member_activity':
        reportData = await generateMemberActivityReport(
          serviceSupabase,
          startDate,
          endDate,
          filters
        )
        break
      case 'post_engagement':
        reportData = await generatePostEngagementReport(
          serviceSupabase,
          startDate,
          endDate,
          filters
        )
        break
      case 'user_registration':
        reportData = await generateUserRegistrationReport(
          serviceSupabase,
          startDate,
          endDate,
          filters
        )
        break
      case 'comprehensive':
        reportData = await generateComprehensiveReport(serviceSupabase, startDate, endDate, filters)
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
        end: endDate.toISOString(),
      },
      filters,
      summary: reportData.summary,
    }

    return NextResponse.json({
      success: true,
      report: {
        metadata: reportMetadata,
        data: reportData.data,
      },
    })
  } catch (error) {
    console.error('Report generation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// 멤버 활동 리포트 생성
async function generateMemberActivityReport(
  supabase: any,
  startDate: Date,
  endDate: Date,
  filters: any
) {
  console.log('멤버 활동 리포트 생성 시작...')

  // 1. 전체 회원 통계 (기본 데이터)
  const { data: allMembers, error: membersError } = await supabase
    .from('member_profiles')
    .select('id, display_name, email, registration_status, created_at, is_active')
    .order('created_at', { ascending: false })

  if (membersError) {
    console.error('회원 데이터 조회 오류:', membersError)
  }

  console.log(`전체 회원 수: ${allMembers?.length || 0}`)

  // 2. 기간별 활동 통계 (수정된 쿼리 - 관계 문제 해결)
  const { data: activities, error: activitiesError } = await supabase
    .from('user_activities')
    .select('id, user_id, action_type, created_at')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  if (activitiesError) {
    console.error('사용자 활동 데이터 조회 오류:', activitiesError)
  }

  console.log(`조회된 활동 수: ${activities?.length || 0}`)

  // 3. 활동별 집계
  const activitySummary =
    activities?.reduce((acc: any, activity: any) => {
      const actionType = activity.action_type
      acc[actionType] = (acc[actionType] || 0) + 1
      return acc
    }, {}) || {}

  // 4. 사용자별 활동 집계 (폴백: 모든 회원 포함)
  const userActivityMap: any = {}

  // 모든 회원을 기본으로 추가
  allMembers?.forEach((member: any) => {
    userActivityMap[member.id] = {
      userId: member.id,
      displayName: member.display_name,
      email: member.email,
      totalActivities: 0,
      activities: {},
      registrationStatus: member.registration_status,
      isActive: member.is_active,
    }
  })

  // 활동 데이터가 있으면 추가 (수동 조인)
  activities?.forEach((activity: any) => {
    const userId = activity.user_id

    // userActivityMap에 사용자가 없으면 (활동은 있지만 member_profiles에 없는 경우) 기본 정보로 추가
    if (!userActivityMap[userId]) {
      userActivityMap[userId] = {
        userId: userId,
        displayName: 'Unknown User',
        email: 'unknown@example.com',
        totalActivities: 0,
        activities: {},
        registrationStatus: 'unknown',
        isActive: false,
      }
    }

    // 활동 수 증가
    userActivityMap[userId].totalActivities++
    userActivityMap[userId].activities[activity.action_type] =
      (userActivityMap[userId].activities[activity.action_type] || 0) + 1
  })

  const userActivities = Object.values(userActivityMap).sort(
    (a: any, b: any) => b.totalActivities - a.totalActivities
  )

  // 5. 회원 통계 요약
  const memberStats = {
    총회원수: allMembers?.length || 0,
    승인회원수: allMembers?.filter((m: any) => m.registration_status === 'approved').length || 0,
    대기회원수: allMembers?.filter((m: any) => m.registration_status === 'pending').length || 0,
    활성회원수: allMembers?.filter((m: any) => m.is_active).length || 0,
  }

  return {
    summary: {
      총활동수: activities?.length || 0,
      순사용자수: activities?.length > 0 ? new Set(activities.map((a: any) => a.user_id)).size : 0,
      주요활동:
        Object.entries(activitySummary).sort(([, a]: any, [, b]: any) => b - a)[0]?.[0] || 'none',
      사용자당평균활동수:
        activities?.length > 0 && userActivities.length > 0
          ? Math.round(
              (activities.length / new Set(activities.map((a: any) => a.user_id)).size) * 100
            ) / 100
          : 0,
      ...memberStats,
    },
    data: {
      activitySummary,
      userActivities: userActivities.slice(0, 50), // 상위 50명만
      dailyActivities: await getDailyActivityBreakdown(supabase, startDate, endDate),
      memberBreakdown: memberStats,
    },
  }
}

// 게시글 참여도 리포트 생성
async function generatePostEngagementReport(
  supabase: any,
  startDate: Date,
  endDate: Date,
  filters: any
) {
  // 게시글 통계 (view_count 포함)
  const { data: posts } = await supabase
    .from('posts')
    .select('id, title, category, created_at, like_count, view_count, is_pinned, author_id')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())
    .order('created_at', { ascending: false })

  // 댓글 통계 (개선된 날짜 범위 사용)
  console.log(`댓글 조회 시작 - 기간: ${startDate.toISOString()} ~ ${endDate.toISOString()}`)

  const { data: comments, error: commentsError } = await supabase
    .from('comments')
    .select('id, post_id, created_at')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  if (commentsError) {
    console.error('댓글 조회 오류:', commentsError)
  }

  console.log(`조회된 댓글 수: ${comments?.length || 0}개`)
  if (comments && comments.length > 0) {
    console.log('조회된 댓글들:')
    comments.forEach((comment: any) => {
      console.log(
        `  - 댓글 ID: ${comment.id}, 게시글: ${comment.post_id}, 작성일: ${comment.created_at}`
      )
    })
  }

  // 게시글별 댓글 수 계산
  const commentsByPost =
    comments?.reduce((acc: any, comment: any) => {
      acc[comment.post_id] = (acc[comment.post_id] || 0) + 1
      return acc
    }, {}) || {}

  // 카테고리별 분석 (올바른 컬럼명 사용)
  const categoryStats =
    posts?.reduce((acc: any, post: any) => {
      const category = post.category
      if (!acc[category]) {
        acc[category] = { count: 0, totalLikes: 0, totalComments: 0 }
      }
      acc[category].count++
      acc[category].totalLikes += post.like_count || 0
      acc[category].totalComments += commentsByPost[post.id] || 0
      return acc
    }, {}) || {}

  return {
    summary: {
      총게시글수: posts?.length || 0,
      총댓글수: comments?.length || 0,
      총조회수: posts?.reduce((sum: number, post: any) => sum + (post.view_count || 0), 0) || 0,
      총좋아요수: posts?.reduce((sum: number, post: any) => sum + (post.like_count || 0), 0) || 0,
      평균참여도:
        posts?.length > 0
          ? Math.round(
              (((comments?.length || 0) +
                (posts?.reduce((sum: number, post: any) => sum + (post.like_count || 0), 0) || 0) +
                (posts?.reduce((sum: number, post: any) => sum + (post.view_count || 0), 0) || 0)) /
                posts.length) *
                100
            ) / 100
          : 0,
    },
    data: {
      topPosts:
        posts?.slice(0, 10).map((post: any) => ({
          ...post,
          commentCount: commentsByPost[post.id] || 0,
        })) || [],
      categoryStats,
      engagementTrends: await getEngagementTrends(supabase, startDate, endDate),
    },
  }
}

// 사용자 등록 리포트 생성
async function generateUserRegistrationReport(
  supabase: any,
  startDate: Date,
  endDate: Date,
  filters: any
) {
  console.log('사용자 등록 리포트 생성 시작...')

  // 1. 기간 내 신규 등록자 (created_at 기준)
  const { data: newRegistrations } = await supabase
    .from('member_profiles')
    .select('id, display_name, email, registration_status, is_artist, created_at')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  console.log(`기간 내 신규 등록: ${newRegistrations?.length || 0}명`)

  // 2. 기간 내 상태가 변경된 회원들 (updated_at 기준)
  const { data: statusChanges } = await supabase
    .from('member_profiles')
    .select('id, display_name, email, registration_status, is_artist, created_at, updated_at')
    .gte('updated_at', startDate.toISOString())
    .lte('updated_at', endDate.toISOString())

  console.log(`기간 내 상태 변경: ${statusChanges?.length || 0}명`)

  // 3. 신규 등록 통계
  const newRegistrationStats =
    newRegistrations?.reduce((acc: any, user: any) => {
      acc[user.registration_status] = (acc[user.registration_status] || 0) + 1
      return acc
    }, {}) || {}

  // 4. 상태 변경 통계 (승인/거부된 회원 추적)
  const statusChangeStats =
    statusChanges?.reduce((acc: any, user: any) => {
      acc[user.registration_status] = (acc[user.registration_status] || 0) + 1
      return acc
    }, {}) || {}

  // 5. 최근 거부된 회원들 (created_at과 관계없이 최근에 거부된 모든 회원)
  const { data: recentlyRejected } = await supabase
    .from('member_profiles')
    .select('id, display_name, email, created_at, updated_at')
    .eq('registration_status', 'rejected')
    .gte('updated_at', startDate.toISOString())
    .lte('updated_at', endDate.toISOString())
    .order('updated_at', { ascending: false })

  console.log(`기간 내 거부된 회원: ${recentlyRejected?.length || 0}명`)

  return {
    summary: {
      // 신규 등록 기준 통계
      총신규등록수: newRegistrations?.length || 0,
      신규승인수: newRegistrationStats.approved || 0,
      신규대기수: newRegistrationStats.pending || 0,
      신규거부수: newRegistrationStats.rejected || 0,

      // 상태 변경 기준 통계 (더 정확한 승인/거부 추적)
      승인수: statusChangeStats.approved || 0,
      대기수: statusChangeStats.pending || 0,
      거부수: recentlyRejected?.length || 0, // 실제 거부된 회원 수

      아티스트수: newRegistrations?.filter((u: any) => u.is_artist).length || 0,
    },
    data: {
      newRegistrationStats,
      statusChangeStats,
      dailyRegistrations: await getDailyRegistrationBreakdown(supabase, startDate, endDate),
      recentRegistrations: newRegistrations?.slice(0, 20) || [],
      recentlyRejected: recentlyRejected || [],
      recentStatusChanges: statusChanges?.slice(0, 20) || [],
    },
  }
}

// 종합 리포트 생성
async function generateComprehensiveReport(
  supabase: any,
  startDate: Date,
  endDate: Date,
  filters: any
) {
  const [memberActivity, postEngagement, userRegistration] = await Promise.all([
    generateMemberActivityReport(supabase, startDate, endDate, filters),
    generatePostEngagementReport(supabase, startDate, endDate, filters),
    generateUserRegistrationReport(supabase, startDate, endDate, filters),
  ])

  return {
    summary: {
      ...memberActivity.summary,
      ...postEngagement.summary,
      ...userRegistration.summary,
      systemHealth: 'good', // 추후 시스템 상태 로직 추가
    },
    data: {
      memberActivity: memberActivity.data,
      postEngagement: postEngagement.data,
      userRegistration: userRegistration.data,
    },
  }
}

// 일별 활동 분석
async function getDailyActivityBreakdown(supabase: any, startDate: Date, endDate: Date) {
  console.log('일별 활동 통계 조회 중...')

  const { data, error } = await supabase
    .from('daily_activity_stats')
    .select('activity_date, action_type, count')
    .gte('activity_date', startDate.toISOString().split('T')[0])
    .lte('activity_date', endDate.toISOString().split('T')[0])
    .order('activity_date', { ascending: true })

  if (error) {
    console.error('일별 활동 통계 조회 오류:', error)
  }

  console.log(`일별 활동 통계 수: ${data?.length || 0}`)
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
  const dailyStats =
    data?.reduce((acc: any, profile: any) => {
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
