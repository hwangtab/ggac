import { createOptionsResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { parseIntegerParam } from '@/utils/queryParams'
import { listProfileSignupsSince } from '@/db/queries/profiles'
import { listPostCreationsSince } from '@/db/queries/posts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 월별 통계 데이터 조회 API
 * GET /api/admin/stats/monthly
 */
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/stats/monthly',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_stats_monthly'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () =>
    NextResponse.json(
      { error: '월별 통계 정보를 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    ),
  handler: async ({ request, auth }) => {
    const { db } = auth

    // 쿼리 파라미터 추출
    const { searchParams } = new URL(request.url)
    const months = parseIntegerParam(searchParams.get('months'), 12, { min: 1, max: 24 })

    // 날짜 범위 계산
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - months)

    // Task 8: member_profiles/posts 조회를 Supabase에서 Turso 쿼리 계층
    // (listProfileSignupsSince/listPostCreationsSince)으로 옮겼다 — 둘 다
    // 이미 Turso가 권위(단계 3c 이후)다. user_activities는 여전히 Supabase
    // 권위(단계 4 대상)라 이 조회만 남긴다 — 이 라우트가 두 DB를 함께 읽는
    // 과도기 상태는 스펙이 허용한 정상 상태다(task-8-brief Step 3). 단계
    // 4에서 user_activities가 Turso로 넘어오면 이 부분도 한 쿼리 계층으로
    // 합쳐진다.
    let memberStats: Awaited<ReturnType<typeof listProfileSignupsSince>>
    try {
      memberStats = await listProfileSignupsSince(startDate)
    } catch (error) {
      console.error('Member stats error:', error)
      return ApiError.internalServerError('회원 통계 조회 실패').toNextResponse()
    }

    // 월별 게시글 통계
    let postStats: Awaited<ReturnType<typeof listPostCreationsSince>>
    try {
      postStats = await listPostCreationsSince(startDate)
    } catch (error) {
      console.error('Post stats error:', error)
      return ApiError.internalServerError('게시글 통계 조회 실패').toNextResponse()
    }

    // 월별 활동 통계 — user_activities는 아직 Supabase 권위(단계 4 대상).
    const { data: activityStats, error: activityError } = await db
      .from('user_activities')
      .select('created_at, action_type')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true })

    if (activityError) {
      console.error('Activity stats error:', activityError)
      return ApiError.internalServerError('활동 통계 조회 실패').toNextResponse()
    }

    // 월별 데이터 그룹화
    const monthlyData: Record<
      string,
      {
        year: number
        month: number
        newMembers: number
        approvedMembers: number
        newPosts: number
        totalActivities: number
        uniqueActiveUsers: Set<string>
      }
    > = {}

    // 지난 N개월 초기화
    for (let i = 0; i < months; i++) {
      const date = new Date()
      date.setMonth(date.getMonth() - i)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

      monthlyData[key] = {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        newMembers: 0,
        approvedMembers: 0,
        newPosts: 0,
        totalActivities: 0,
        uniqueActiveUsers: new Set(),
      }
    }

    // 회원 데이터 집계
    memberStats?.forEach(member => {
      const date = new Date(member.created_at)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

      if (monthlyData[key]) {
        monthlyData[key].newMembers++
        if (member.registration_status === 'approved') {
          monthlyData[key].approvedMembers++
        }
      }
    })

    // 게시글 데이터 집계
    postStats?.forEach(post => {
      const date = new Date(post.created_at)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

      if (monthlyData[key]) {
        monthlyData[key].newPosts++
      }
    })

    // 활동 데이터 집계
    activityStats?.forEach(activity => {
      const date = new Date(activity.created_at)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

      if (monthlyData[key]) {
        monthlyData[key].totalActivities++
        // user_id가 있다면 고유 사용자로 추가 (실제 스키마에 맞게 수정 필요)
        // monthlyData[key].uniqueActiveUsers.add(activity.user_id)
      }
    })

    // 결과 정렬 및 포맷팅
    const sortedMonths = Object.keys(monthlyData).sort().reverse() // 최신 월부터

    const monthlyStats = sortedMonths.map(key => {
      const data = monthlyData[key]
      return {
        year: data.year,
        month: data.month,
        monthKey: key,
        monthLabel: `${data.year}년 ${data.month}월`,
        newMembers: data.newMembers,
        approvedMembers: data.approvedMembers,
        newPosts: data.newPosts,
        totalActivities: data.totalActivities,
        activeUsers: data.uniqueActiveUsers.size,
      }
    })

    // 현재 월과 이전 월 비교
    const thisMonth = monthlyStats[0] || null
    const lastMonth = monthlyStats[1] || null

    const calculateTrend = (current: number, previous: number) => {
      if (previous === 0) return { change: '0%', trend: 'stable' as const, value: 0 }
      const percentage = Math.round(((current - previous) / previous) * 100)
      return {
        change: `${percentage >= 0 ? '+' : ''}${percentage}%`,
        trend:
          percentage > 5
            ? ('up' as const)
            : percentage < -5
              ? ('down' as const)
              : ('stable' as const),
        value: percentage,
      }
    }

    const trends =
      thisMonth && lastMonth
        ? {
            members: calculateTrend(thisMonth.newMembers, lastMonth.newMembers),
            posts: calculateTrend(thisMonth.newPosts, lastMonth.newPosts),
            activities: calculateTrend(thisMonth.totalActivities, lastMonth.totalActivities),
            activeUsers: calculateTrend(thisMonth.activeUsers, lastMonth.activeUsers),
          }
        : null

    return ApiSuccess.ok({
      monthlyStats,
      currentMonth: thisMonth,
      previousMonth: lastMonth,
      trends,
      metadata: {
        months,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        generatedAt: new Date().toISOString(),
      },
    })
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
