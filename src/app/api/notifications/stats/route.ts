/**
 * 알림 통계 API
 * GET: 사용자 알림 통계 조회
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import type { NotificationStats } from '@/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Rate limiting 설정
const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('notification_stats'),
})

export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const supabase = await createSupabaseServer()

    // 사용자 인증 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 알림 통계 조회
    const { data: stats, error } = await supabase
      .from('notification_stats')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      // 데이터가 없는 경우는 에러가 아님
      console.error('알림 통계 조회 오류:', error)
      return NextResponse.json({ error: '통계를 불러올 수 없습니다.' }, { status: 500 })
    }

    // 데이터가 없는 경우 기본값 반환
    const defaultStats: NotificationStats = {
      user_id: user.id,
      total_notifications: 0,
      unread_count: 0,
      read_count: 0,
      latest_notification_at: null,
    }

    return NextResponse.json(stats || defaultStats)
  } catch (error) {
    console.error('알림 통계 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
