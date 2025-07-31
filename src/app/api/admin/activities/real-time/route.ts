import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/utils/rateLimit'

/**
 * 실시간 활성 사용자 조회 API
 * GET /api/admin/activities/real-time
 */
export async function GET(request: NextRequest) {
  return withRateLimit('ADMIN_API')(async () => {
    try {
      const supabase = createServerComponentClient({ cookies })
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
      }

      // 관리자 권한 확인
      const { data: profile } = await supabase
        .from('member_profiles')
        .select('is_admin, registration_status')
        .eq('id', session.user.id)
        .single()

      if (!profile?.is_admin || profile.registration_status !== 'approved') {
        return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
      }

      const { searchParams } = new URL(request.url)
      const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
      const includeActivity = searchParams.get('include_activity') === 'true'

      // 실시간 활성 사용자 조회 (active_users_view 사용)
      const { data: activeUsers, error: activeError } = await supabase
        .from('active_users_view')
        .select('*')
        .limit(limit)

      if (activeError) {
        console.error('활성 사용자 조회 오류:', activeError)
        return NextResponse.json({ error: '활성 사용자 데이터 조회에 실패했습니다.' }, { status: 500 })
      }

      let recentActivity = []
      if (includeActivity) {
        // 최근 활동 피드 조회
        const { data: activityData, error: activityError } = await supabase
          .rpc('get_real_time_activity_feed', {
            p_limit: 30
          })

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
      const sessionsByTime = activeUsers?.reduce((acc: Record<string, number>, user: any) => {
        const hour = new Date(user.last_activity).getHours()
        const timeSlot = `${hour}:00-${hour + 1}:00`
        acc[timeSlot] = (acc[timeSlot] || 0) + 1
        return acc
      }, {}) || {}

      return NextResponse.json({
        activeUsers: activeUsers || [],
        recentActivity,
        statistics: {
          활성사용자수: activeCount,
          총세션수: totalSessions,
          시간대별세션수: sessionsByTime,
          평균세션시간: activeUsers?.reduce((sum: number, user: any) => {
            return sum + (user.minutes_since_activity || 0)
          }, 0) / Math.max(activeCount, 1)
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          refreshInterval: 30, // 초
          includeActivity
        }
      })

    } catch (error) {
      console.error('실시간 활성 API 오류:', error)
      return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
    }
  })(request)
}
