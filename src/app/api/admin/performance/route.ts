/**
 * API 성능 모니터링 대시보드 엔드포인트
 * 관리자용 성능 통계 및 메트릭 조회
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/adminAuth'
import { getApiStats, getApiHealth, exportApiMetrics } from '@/utils/apiPerformanceMonitor'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'

export async function GET(request: NextRequest) {
  try {
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_performance'),
    })
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'dashboard'
    const endpoint = searchParams.get('endpoint')
    const timeWindow = parseInt(searchParams.get('timeWindow') || '3600000') // 기본 1시간

    let response: NextResponse

    switch (action) {
      case 'dashboard': {
        const dashboardData = getApiStats(undefined, timeWindow)
        response = NextResponse.json({
          success: true,
          data: dashboardData,
          timeWindow,
          timestamp: new Date().toISOString(),
        })
        break
      }

      case 'endpoint': {
        if (!endpoint) {
          return NextResponse.json({ error: 'endpoint 파라미터가 필요합니다.' }, { status: 400 })
        }

        const endpointStats = getApiStats(endpoint, timeWindow)
        response = NextResponse.json({
          success: true,
          data: endpointStats,
          endpoint,
          timeWindow,
          timestamp: new Date().toISOString(),
        })
        break
      }

      case 'health': {
        const healthData = getApiHealth()
        response = NextResponse.json({
          success: true,
          data: healthData,
          timestamp: new Date().toISOString(),
        })
        break
      }

      case 'export': {
        const startTime = searchParams.get('startTime')
        const endTime = searchParams.get('endTime')

        if (!startTime || !endTime) {
          return NextResponse.json(
            { error: 'startTime과 endTime 파라미터가 필요합니다.' },
            { status: 400 }
          )
        }

        try {
          const exportedMetrics = exportApiMetrics(startTime, endTime, endpoint || undefined)
          response = NextResponse.json({
            success: true,
            data: exportedMetrics,
            count: exportedMetrics.length,
            startTime,
            endTime,
            endpoint: endpoint || 'all',
            timestamp: new Date().toISOString(),
          })
        } catch {
          return NextResponse.json(
            { error: '메트릭 내보내기 중 오류가 발생했습니다.' },
            { status: 500 }
          )
        }
        break
      }

      default:
        return NextResponse.json({ error: '지원하지 않는 액션입니다.' }, { status: 400 })
    }

    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('API 성능 모니터링 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
