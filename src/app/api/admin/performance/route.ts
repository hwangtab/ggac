/**
 * API 성능 모니터링 대시보드 엔드포인트
 * 관리자용 성능 통계 및 메트릭 조회
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { createOptionsResponse, createErrorResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/adminAuth'
import { getApiStats, getApiHealth, exportApiMetrics } from '@/utils/apiPerformanceMonitor'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'
import { parseIntegerParam } from '@/utils/queryParams'
import { parsePerformanceAction } from '@/constants/adminAnalytics'

const MAX_EXPORT_RANGE_MS = 7 * 24 * 60 * 60 * 1000

function parseMetricTimestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET(request: NextRequest) {
  try {
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_performance'),
    })
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const { searchParams } = new URL(request.url)
    const actionParam = searchParams.get('action') || 'dashboard'
    const action = parsePerformanceAction(actionParam)
    const endpoint = searchParams.get('endpoint')
    const timeWindow = parseIntegerParam(searchParams.get('timeWindow'), 3600000, {
      min: 60000,
      max: 7 * 24 * 60 * 60 * 1000,
    })

    if (!action) {
      return createErrorResponse({ success: false, error: '지원하지 않는 액션입니다.' }, 400)
    }

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
          return createErrorResponse(
            { success: false, error: 'endpoint 파라미터가 필요합니다.' },
            400
          )
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
        const parsedStartTime = parseMetricTimestamp(startTime)
        const parsedEndTime = parseMetricTimestamp(endTime)

        if (parsedStartTime === null || parsedEndTime === null) {
          return NextResponse.json(
            { error: 'startTime과 endTime은 유효한 날짜/시간이어야 합니다.' },
            { status: 400 }
          )
        }

        if (parsedStartTime > parsedEndTime) {
          return NextResponse.json(
            { error: 'startTime은 endTime보다 늦을 수 없습니다.' },
            { status: 400 }
          )
        }

        if (parsedEndTime - parsedStartTime > MAX_EXPORT_RANGE_MS) {
          return NextResponse.json(
            { error: '내보내기 기간은 7일을 초과할 수 없습니다.' },
            { status: 400 }
          )
        }

        try {
          const normalizedStartTime = new Date(parsedStartTime).toISOString()
          const normalizedEndTime = new Date(parsedEndTime).toISOString()
          const exportedMetrics = exportApiMetrics(
            normalizedStartTime,
            normalizedEndTime,
            endpoint || undefined
          )
          response = NextResponse.json({
            success: true,
            data: exportedMetrics,
            count: exportedMetrics.length,
            startTime: normalizedStartTime,
            endTime: normalizedEndTime,
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

      default: {
        const exhaustiveCheck: never = action
        return exhaustiveCheck
      }
    }

    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('API 성능 모니터링 API 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
