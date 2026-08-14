/**
 * 알림 통계 API
 * GET: 사용자 알림 통계 조회
 */

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { NotificationStats } from '@/types'
import { requireUser } from '@/lib/server/memberAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.GENERAL_API,
      keyGenerator: createUserKeyGenerator('notification_stats'),
    })
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    // 사용자 인증 확인
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const supabase = await createSupabaseServer()

    // 알림 통계 조회
    const { data: stats, error } = await supabase
      .from('notification_stats')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      // 데이터가 없는 경우는 에러가 아님
      console.error('알림 통계 조회 오류:', error)
      return ApiError.internalServerError('통계를 불러올 수 없습니다.').toNextResponse()
    }

    // 데이터가 없는 경우 기본값 반환
    const defaultStats: NotificationStats = {
      user_id: user.id,
      total_notifications: 0,
      unread_count: 0,
      read_count: 0,
      latest_notification_at: null,
    }

    return ApiSuccess.ok(stats || defaultStats).toNextResponse()
  } catch (error) {
    console.error('알림 통계 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
