/**
 * 알림 통계 API
 * GET: 사용자 알림 통계 조회
 */

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/lib/server/rateLimit'
import { requireUser } from '@/lib/server/memberAuth'
import { getNotificationStats } from '@/db/queries/notifications'

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

    // 알림 통계 조회. notification_stats 뷰(GROUP BY user_id) 대체 —
    // 알림이 하나도 없는 사용자도 0으로 채운 통계 객체를 항상 돌려준다(뷰가
    // 행 자체를 안 돌려주던 경우의 기존 기본값 대체 로직과 최종 응답이
    // 동일하다).
    let stats: Awaited<ReturnType<typeof getNotificationStats>>
    try {
      stats = await getNotificationStats(user.id)
    } catch (error) {
      console.error('알림 통계 조회 오류:', error)
      return ApiError.internalServerError('통계를 불러올 수 없습니다.').toNextResponse()
    }

    return ApiSuccess.ok(stats).toNextResponse()
  } catch (error) {
    console.error('알림 통계 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
