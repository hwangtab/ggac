import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { withRateLimit } from '@/utils/rateLimit'
import { requireAdmin } from '@/lib/server/adminAuth'

/**
 * 사용자별 활동 조회 API
 * GET /api/admin/activities/users
 */
export async function GET(request: NextRequest) {
  return withRateLimit('ADMIN_API')(async () => {
    try {
      const auth = await requireAdmin()
      if (auth instanceof NextResponse) return auth
      const { db } = auth

      const { searchParams } = new URL(request.url)
      const userId = searchParams.get('user_id')
      const page = parseInt(searchParams.get('page') || '1')
      const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
      const days = parseInt(searchParams.get('days') || '30')
      const actionType = searchParams.get('action_type')
      const targetType = searchParams.get('target_type')

      const offset = (page - 1) * limit
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      // 기본 쿼리 구성
      let query = db
        .from('user_activities')
        .select(
          `
          id,
          user_id,
          action_type,
          target_type,
          target_id,
          metadata,
          ip_address,
          user_agent,
          session_id,
          created_at,
          member_profiles!user_id (
            display_name,
            email
          )
        `,
          { count: 'exact' }
        )
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      // 필터 적용
      if (userId) {
        query = query.eq('user_id', userId)
      }
      if (actionType) {
        query = query.eq('action_type', actionType)
      }
      if (targetType) {
        query = query.eq('target_type', targetType)
      }

      const { data: activities, error, count } = await query

      if (error) {
        console.error('활동 조회 오류:', error)
        return createErrorResponse({ success: false, error: '활동 데이터 조회에 실패했습니다.' }, 500)
      }

      const totalCount = count || 0
      const totalPages = Math.ceil(totalCount / limit)
      const hasNext = page < totalPages
      const hasPrev = page > 1

      return NextResponse.json({
        activities: activities || [],
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNext,
          hasPrev,
        },
        filters: {
          userId,
          days,
          actionType,
          targetType,
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          period: `${days}일`,
          startDate: startDate.toISOString(),
        },
      })
    } catch (error) {
      console.error('사용자 활동 API 오류:', error)
      return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
    }
  })(request)
}
