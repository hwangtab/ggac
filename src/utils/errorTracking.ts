'use client'

interface ErrorReport {
  errorId: string
  componentName: string
  errorType: string
  message: string
  stack?: string
  timestamp: string
  url: string
  userAgent: string
  buildVersion: string
  userId?: string
  sessionId: string
}

interface ErrorMetrics {
  totalErrors: number
  errorsByComponent: Record<string, number>
  errorsByType: Record<string, number>
  criticalErrors: number
  lastError?: ErrorReport
}

/**
 * 전역 에러 추적 및 분석 시스템
 */
class ErrorTracker {
  private errors: ErrorReport[] = []
  private sessionId: string
  private maxErrors = 100 // 메모리 사용량 제한

  constructor() {
    this.sessionId = this.generateSessionId()

    // 전역 에러 핸들러 등록
    this.setupGlobalErrorHandlers()

    // 전역 객체에 등록 (성능 모니터링과 연동)
    if (typeof window !== 'undefined') {
      ;(window as any).__ERROR_TRACKER__ = this
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 전역 에러 핸들러 설정
   */
  private setupGlobalErrorHandlers() {
    if (typeof window === 'undefined') return

    // JavaScript 런타임 에러
    window.addEventListener('error', event => {
      this.trackError({
        componentName: 'Global',
        errorType: 'RuntimeError',
        message: event.message,
        stack: event.error?.stack,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })
    })

    // Promise rejection 에러
    window.addEventListener('unhandledrejection', event => {
      this.trackError({
        componentName: 'Global',
        errorType: 'UnhandledPromiseRejection',
        message:
          typeof event.reason === 'string'
            ? event.reason
            : event.reason?.message || 'Unknown promise rejection',
        stack: event.reason?.stack,
      })
    })

    // 리소스 로딩 에러
    window.addEventListener(
      'error',
      event => {
        if (event.target && event.target !== window) {
          const target = event.target as HTMLElement
          this.trackError({
            componentName: 'ResourceLoader',
            errorType: 'ResourceLoadError',
            message: `Failed to load resource: ${target.tagName}`,
            resource: (target as any).src || (target as any).href,
          })
        }
      },
      true
    )
  }

  /**
   * 에러 추적
   */
  trackError(errorData: {
    componentName: string
    errorType: string
    message: string
    stack?: string
    filename?: string
    lineno?: number
    colno?: number
    resource?: string
    customData?: Record<string, any>
  }) {
    const errorReport: ErrorReport = {
      errorId: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      componentName: errorData.componentName,
      errorType: errorData.errorType,
      message: errorData.message,
      stack: errorData.stack,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      buildVersion: process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown',
      sessionId: this.sessionId,
    }

    // 에러 저장
    this.errors.push(errorReport)

    // 메모리 사용량 제한
    if (this.errors.length > this.maxErrors) {
      this.errors.shift()
    }

    // 개발 환경에서 콘솔 로그
    if (process.env.NODE_ENV === 'development') {
      console.group(`🚨 ErrorTracker: ${errorData.componentName}`)
      console.error('Error Type:', errorData.errorType)
      console.error('Message:', errorData.message)
      if (errorData.stack) console.error('Stack:', errorData.stack)
      console.error('Error ID:', errorReport.errorId)
      console.groupEnd()
    }

    // 치명적 에러 감지
    if (this.isCriticalError(errorData)) {
      this.handleCriticalError(errorReport)
    }

    // 성능 모니터링 시스템에 알림
    this.notifyPerformanceMonitor(errorReport)
  }

  /**
   * 치명적 에러 판단
   */
  private isCriticalError(errorData: { errorType: string; componentName: string }): boolean {
    const criticalTypes = ['ChunkLoadError', 'SecurityError', 'NetworkError']
    const criticalComponents = ['App', 'RootLayout', 'ErrorBoundary']

    return (
      criticalTypes.includes(errorData.errorType) ||
      criticalComponents.includes(errorData.componentName)
    )
  }

  /**
   * 치명적 에러 처리
   */
  private handleCriticalError(errorReport: ErrorReport) {
    console.error('🚨 Critical error detected:', errorReport)

    // 프로덕션에서 외부 서비스로 즉시 전송
    if (process.env.NODE_ENV === 'production') {
      this.sendToExternalService([errorReport], true)
    }
  }

  /**
   * 성능 모니터링 시스템에 알림
   */
  private notifyPerformanceMonitor(errorReport: ErrorReport) {
    if (typeof window !== 'undefined' && (window as any).__PERFORMANCE_MONITOR__) {
      const monitor = (window as any).__PERFORMANCE_MONITOR__
      monitor.reportError?.(errorReport)
    }
  }

  /**
   * 외부 로깅 서비스로 전송
   */
  private async sendToExternalService(errors: ErrorReport[], immediate = false) {
    // 실제 환경에서는 Sentry, LogRocket, DataDog 등의 서비스 사용
    console.log('Sending errors to external service:', errors)

    // 예시: fetch를 사용한 로깅 서비스 전송
    /*
    try {
      await fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errors, immediate })
      })
    } catch (error) {
      console.error('Failed to send errors to service:', error)
    }
    */
  }

  /**
   * 에러 메트릭 계산
   */
  getMetrics(): ErrorMetrics {
    const metrics: ErrorMetrics = {
      totalErrors: this.errors.length,
      errorsByComponent: {},
      errorsByType: {},
      criticalErrors: 0,
      lastError: this.errors[this.errors.length - 1],
    }

    this.errors.forEach(error => {
      // 컴포넌트별 집계
      metrics.errorsByComponent[error.componentName] =
        (metrics.errorsByComponent[error.componentName] || 0) + 1

      // 타입별 집계
      metrics.errorsByType[error.errorType] = (metrics.errorsByType[error.errorType] || 0) + 1

      // 치명적 에러 카운트
      if (
        this.isCriticalError({ errorType: error.errorType, componentName: error.componentName })
      ) {
        metrics.criticalErrors++
      }
    })

    return metrics
  }

  /**
   * 에러 보고서 생성
   */
  generateReport() {
    const metrics = this.getMetrics()
    const recentErrors = this.errors.slice(-10) // 최근 10개 에러

    return {
      summary: {
        sessionId: this.sessionId,
        totalErrors: metrics.totalErrors,
        criticalErrors: metrics.criticalErrors,
        timestamp: new Date().toISOString(),
        url: window.location.href,
      },
      metrics,
      recentErrors,
      recommendations: this.generateRecommendations(metrics),
    }
  }

  /**
   * 개선 권장사항 생성
   */
  private generateRecommendations(metrics: ErrorMetrics): string[] {
    const recommendations: string[] = []

    // 높은 에러율 컴포넌트 식별
    const topErrorComponents = Object.entries(metrics.errorsByComponent)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)

    topErrorComponents.forEach(([component, count]) => {
      if (count > 5) {
        recommendations.push(
          `${component} 컴포넌트에서 ${count}개의 에러가 발생했습니다. 안정성 개선이 필요합니다.`
        )
      }
    })

    // 치명적 에러 경고
    if (metrics.criticalErrors > 0) {
      recommendations.push(
        `${metrics.criticalErrors}개의 치명적 에러가 감지되었습니다. 즉시 수정이 필요합니다.`
      )
    }

    // 리소스 로딩 에러
    if (metrics.errorsByType['ResourceLoadError'] > 0) {
      recommendations.push('리소스 로딩 에러가 감지되었습니다. CDN 상태나 파일 경로를 확인하세요.')
    }

    return recommendations
  }

  /**
   * 에러 데이터 정리
   */
  clearErrors() {
    this.errors = []
  }

  /**
   * 특정 조건의 에러 필터링
   */
  getErrorsByComponent(componentName: string): ErrorReport[] {
    return this.errors.filter(error => error.componentName === componentName)
  }

  getErrorsByType(errorType: string): ErrorReport[] {
    return this.errors.filter(error => error.errorType === errorType)
  }

  /**
   * 에러 패턴 분석
   */
  analyzeErrorPatterns() {
    const patterns = {
      frequentErrors: {} as Record<string, number>,
      timePatterns: {} as Record<string, number>,
      componentRelations: {} as Record<string, string[]>,
    }

    this.errors.forEach(error => {
      // 빈도 패턴
      const key = `${error.componentName}:${error.errorType}`
      patterns.frequentErrors[key] = (patterns.frequentErrors[key] || 0) + 1

      // 시간 패턴 (시간대별)
      const hour = new Date(error.timestamp).getHours()
      patterns.timePatterns[hour] = (patterns.timePatterns[hour] || 0) + 1
    })

    return patterns
  }
}

// 전역 에러 트래커 인스턴스
let globalErrorTracker: ErrorTracker | null = null

export const getErrorTracker = (): ErrorTracker => {
  if (!globalErrorTracker && typeof window !== 'undefined') {
    globalErrorTracker = new ErrorTracker()
  }
  return globalErrorTracker!
}

export default ErrorTracker
export type { ErrorReport, ErrorMetrics }
