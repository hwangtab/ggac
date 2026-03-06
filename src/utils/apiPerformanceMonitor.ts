/**
 * API 성능 모니터링 시스템
 * 응답 시간, 에러율, 처리량을 실시간으로 추적
 */

import { NextRequest, NextResponse } from 'next/server'

// 성능 메트릭 인터페이스
interface ApiMetrics {
  endpoint: string
  method: string
  timestamp: string
  duration: number
  statusCode: number
  success: boolean
  userAgent?: string
  ip?: string
  error?: string
  memoryUsage?: {
    heapUsed: number
    heapTotal: number
    external: number
  }
}

// 집계 통계 인터페이스
interface ApiStats {
  endpoint: string
  totalRequests: number
  successCount: number
  errorCount: number
  averageResponseTime: number
  p95ResponseTime: number
  p99ResponseTime: number
  errorRate: number
  requestsPerMinute: number
  lastUpdated: string
}

// 실시간 성능 모니터
class ApiPerformanceMonitor {
  private metrics: ApiMetrics[] = []
  private maxMetrics: number = 10000 // 최대 저장할 메트릭 수
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // 5분마다 오래된 메트릭 정리
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupOldMetrics()
      },
      5 * 60 * 1000
    )
  }

  // 요청 시작 시간 기록
  startRequest(request: NextRequest): number {
    return Date.now()
  }

  // 요청 완료 후 메트릭 기록
  recordMetric(
    request: NextRequest,
    response: NextResponse,
    startTime: number,
    error?: Error
  ): void {
    const duration = Date.now() - startTime
    const url = new URL(request.url)
    const endpoint = this.normalizeEndpoint(url.pathname)

    // IP 주소 추출
    const forwarded = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const ip = forwarded ? forwarded.split(',')[0] : realIp || 'unknown'

    // 메모리 사용량 (개발 환경에서만)
    const memoryUsage =
      process.env.NODE_ENV === 'development'
        ? {
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            external: Math.round(process.memoryUsage().external / 1024 / 1024),
          }
        : undefined

    const metric: ApiMetrics = {
      endpoint,
      method: request.method,
      timestamp: new Date().toISOString(),
      duration,
      statusCode: response.status,
      success: response.status < 400,
      userAgent: request.headers.get('user-agent') || undefined,
      ip,
      error: error?.message,
      memoryUsage,
    }

    this.metrics.push(metric)

    // 메트릭 수 제한
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics)
    }

    // 성능 경고 체크
    this.checkPerformanceAlerts(metric)
  }

  // 엔드포인트 정규화 (동적 라우트 처리)
  private normalizeEndpoint(pathname: string): string {
    return pathname
      .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/:id')
      .replace(/\/\d+/g, '/:id')
      .replace(/\/[^\/]+$/g, match => {
        // 파일 확장자가 있으면 그대로, 없으면 :param으로 처리
        return match.includes('.') ? match : '/:param'
      })
  }

  // 특정 엔드포인트의 통계 계산
  getEndpointStats(endpoint: string, timeWindow: number = 3600000): ApiStats {
    const now = Date.now()
    const cutoff = now - timeWindow

    const endpointMetrics = this.metrics.filter(
      m => m.endpoint === endpoint && new Date(m.timestamp).getTime() > cutoff
    )

    if (endpointMetrics.length === 0) {
      return {
        endpoint,
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        averageResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        errorRate: 0,
        requestsPerMinute: 0,
        lastUpdated: new Date().toISOString(),
      }
    }

    const successCount = endpointMetrics.filter(m => m.success).length
    const errorCount = endpointMetrics.length - successCount
    const durations = endpointMetrics.map(m => m.duration).sort((a, b) => a - b)

    const averageResponseTime = durations.reduce((sum, d) => sum + d, 0) / durations.length
    const p95Index = Math.floor(durations.length * 0.95)
    const p99Index = Math.floor(durations.length * 0.99)

    const requestsPerMinute = endpointMetrics.length / (timeWindow / 60000)

    return {
      endpoint,
      totalRequests: endpointMetrics.length,
      successCount,
      errorCount,
      averageResponseTime: Math.round(averageResponseTime),
      p95ResponseTime: durations[p95Index] || 0,
      p99ResponseTime: durations[p99Index] || 0,
      errorRate: (errorCount / endpointMetrics.length) * 100,
      requestsPerMinute: Math.round(requestsPerMinute * 100) / 100,
      lastUpdated: new Date().toISOString(),
    }
  }

  // 전체 API 대시보드 데이터
  getDashboardData(timeWindow: number = 3600000): {
    overview: {
      totalRequests: number
      successRate: number
      averageResponseTime: number
      activeEndpoints: number
    }
    topEndpoints: ApiStats[]
    slowestEndpoints: ApiStats[]
    errorProneEndpoints: ApiStats[]
    recentErrors: ApiMetrics[]
  } {
    const now = Date.now()
    const cutoff = now - timeWindow

    const recentMetrics = this.metrics.filter(m => new Date(m.timestamp).getTime() > cutoff)

    // 엔드포인트별 그룹화
    const endpointGroups = new Map<string, ApiMetrics[]>()
    recentMetrics.forEach(metric => {
      const endpoint = metric.endpoint
      if (!endpointGroups.has(endpoint)) {
        endpointGroups.set(endpoint, [])
      }
      endpointGroups.get(endpoint)!.push(metric)
    })

    // 각 엔드포인트의 통계 계산
    const endpointStats = Array.from(endpointGroups.keys()).map(endpoint =>
      this.getEndpointStats(endpoint, timeWindow)
    )

    // 전체 개요
    const totalRequests = recentMetrics.length
    const successCount = recentMetrics.filter(m => m.success).length
    const averageResponseTime =
      totalRequests > 0 ? recentMetrics.reduce((sum, m) => sum + m.duration, 0) / totalRequests : 0

    // 상위 엔드포인트들
    const topEndpoints = endpointStats
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 10)

    const slowestEndpoints = endpointStats
      .filter(s => s.totalRequests > 5) // 최소 요청 수 필터
      .sort((a, b) => b.averageResponseTime - a.averageResponseTime)
      .slice(0, 10)

    const errorProneEndpoints = endpointStats
      .filter(s => s.errorRate > 0)
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 10)

    // 최근 에러들
    const recentErrors = recentMetrics
      .filter(m => !m.success)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20)

    return {
      overview: {
        totalRequests,
        successRate: totalRequests > 0 ? (successCount / totalRequests) * 100 : 100,
        averageResponseTime: Math.round(averageResponseTime),
        activeEndpoints: endpointGroups.size,
      },
      topEndpoints,
      slowestEndpoints,
      errorProneEndpoints,
      recentErrors,
    }
  }

  // 성능 경고 체크
  private checkPerformanceAlerts(metric: ApiMetrics): void {
    // 느린 응답 시간 경고 (5초 이상)
    if (metric.duration > 5000) {
      console.warn(`🐌 Slow API response: ${metric.endpoint} (${metric.duration}ms)`)
    }

    // 에러 응답 경고
    if (!metric.success) {
      console.warn(
        `❌ API error: ${metric.endpoint} (${metric.statusCode}) - ${metric.error || 'Unknown error'}`
      )
    }

    // 메모리 사용량 경고 (개발 환경)
    if (metric.memoryUsage && metric.memoryUsage.heapUsed > 500) {
      console.warn(`💾 High memory usage: ${metric.endpoint} (${metric.memoryUsage.heapUsed}MB)`)
    }
  }

  // 오래된 메트릭 정리
  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000 // 24시간
    const initialLength = this.metrics.length

    this.metrics = this.metrics.filter(m => new Date(m.timestamp).getTime() > cutoff)

    const removed = initialLength - this.metrics.length
    if (removed > 0) {
      console.log(`🧹 Cleaned up ${removed} old API metrics`)
    }
  }

  // 특정 시간대의 메트릭 내보내기
  exportMetrics(startTime: string, endTime: string, endpoint?: string): ApiMetrics[] {
    const start = new Date(startTime).getTime()
    const end = new Date(endTime).getTime()

    return this.metrics.filter(m => {
      const timestamp = new Date(m.timestamp).getTime()
      const inTimeRange = timestamp >= start && timestamp <= end
      const matchesEndpoint = !endpoint || m.endpoint === endpoint

      return inTimeRange && matchesEndpoint
    })
  }

  // 리소스 정리
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.metrics = []
  }
}

// 미들웨어 함수
function createApiPerformanceMiddleware(monitor: ApiPerformanceMonitor) {
  return (handler: any) => {
    return async (request: NextRequest, context?: any) => {
      const startTime = monitor.startRequest(request)
      let response: NextResponse
      let error: Error | undefined

      try {
        // 원본 핸들러 실행
        response = await handler(request, context)
      } catch (err) {
        error = err as Error
        // 에러 응답 생성
        response = NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
      }

      // 메트릭 기록
      monitor.recordMetric(request, response, startTime, error)

      return response
    }
  }
}

// 전역 모니터 인스턴스
const apiPerformanceMonitor = new ApiPerformanceMonitor()

// 성능 대시보드 API용 함수들
export const getApiStats = (endpoint?: string, timeWindow?: number) => {
  if (endpoint) {
    return apiPerformanceMonitor.getEndpointStats(endpoint, timeWindow)
  }
  return apiPerformanceMonitor.getDashboardData(timeWindow)
}

export const exportApiMetrics = (startTime: string, endTime: string, endpoint?: string) => {
  return apiPerformanceMonitor.exportMetrics(startTime, endTime, endpoint)
}

// 헬스체크 함수
export const getApiHealth = () => {
  const dashboardData = apiPerformanceMonitor.getDashboardData(300000) // 5분 윈도우
  const { overview } = dashboardData

  return {
    status:
      overview.successRate > 95 ? 'healthy' : overview.successRate > 80 ? 'degraded' : 'unhealthy',
    successRate: overview.successRate,
    averageResponseTime: overview.averageResponseTime,
    totalRequests: overview.totalRequests,
    timestamp: new Date().toISOString(),
  }
}

export {
  ApiPerformanceMonitor,
  apiPerformanceMonitor,
  createApiPerformanceMiddleware,
  type ApiMetrics,
  type ApiStats,
}

export default apiPerformanceMonitor
