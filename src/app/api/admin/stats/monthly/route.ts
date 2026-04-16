import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/adminAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 월별 통계 데이터 조회 API
 * GET /api/admin/stats/monthly
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const { db } = auth

    // 쿼리 파라미터 추출
    const { searchParams } = new URL(request.url)
    const months = Math.min(parseInt(searchParams.get('months') || '12'), 24) // 최대 24개월

    // 날짜 범위 계산
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - months)

    // 월별 회원 가입 통계
    const { data: memberStats, error: memberError } = await db
      .from('member_profiles')
      .select('created_at, registration_status')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true })

    if (memberError) {
      console.error('Member stats error:', memberError)
      return NextResponse.json({ error: '회원 통계 조회 실패' }, { status: 500 })
    }

    // 월별 게시글 통계
    const { data: postStats, error: postError } = await db
      .from('posts')
      .select('created_at, is_deleted')
      .gte('created_at', startDate.toISOString())
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })

    if (postError) {
      console.error('Post stats error:', postError)
      return NextResponse.json({ error: '게시글 통계 조회 실패' }, { status: 500 })
    }

    // 월별 활동 통계
    const { data: activityStats, error: activityError } = await db
      .from('user_activities')
      .select('created_at, action_type')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true })

    if (activityError) {
      console.error('Activity stats error:', activityError)
      return NextResponse.json({ error: '활동 통계 조회 실패' }, { status: 500 })
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

    return NextResponse.json({
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
  } catch (error) {
    console.error('Monthly stats API error:', error)
    return NextResponse.json(
      { error: '월별 통계 정보를 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
