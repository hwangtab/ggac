'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
  errorInfo?: ErrorInfo
  errorId?: string
  retryCount: number
}

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: React.ComponentType<ErrorFallbackProps>
  onError?: (error: Error, errorInfo: ErrorInfo, errorId: string) => void
  // 컴포넌트 이름 (로깅용)
  componentName?: string
  // 최대 재시도 횟수
  maxRetries?: number
  // 자동 복구 시간 (밀리초)
  autoRecoveryTime?: number
  // 에러 타입별 커스텀 처리
  errorHandlers?: Record<string, (error: Error) => ReactNode>
}

interface ErrorFallbackProps {
  error?: Error
  errorInfo?: ErrorInfo
  errorId?: string
  retryCount: number
  reset: () => void
  componentName?: string
}

/**
 * 강화된 에러 바운더리 컴포넌트
 * - 에러 추적 및 로깅
 * - 자동 복구 메커니즘
 * - 컴포넌트별 커스텀 fallback
 * - 성능 모니터링 연동
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private autoRecoveryTimer?: NodeJS.Timeout
  private retryTimer?: NodeJS.Timeout
  private mounted = true

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      retryCount: 0,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // 고유한 에러 ID 생성
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    return {
      hasError: true,
      error,
      errorId,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { componentName = 'Unknown', onError } = this.props
    const errorId = this.state.errorId || 'unknown'

    // 에러 정보 보강
    this.setState({ errorInfo })

    // 에러 로깅 (개발 환경)
    if (process.env.NODE_ENV === 'development') {
      console.group(`🚨 ErrorBoundary: ${componentName}`)
      console.error('Error:', error)
      console.error('Error Info:', errorInfo)
      console.error('Error ID:', errorId)
      console.error('Component Stack:', errorInfo.componentStack)
      console.groupEnd()
    }

    // 프로덕션 환경에서는 외부 로깅 서비스로 전송
    if (process.env.NODE_ENV === 'production') {
      this.logErrorToService(error, errorInfo, errorId, componentName)
    }

    // 커스텀 에러 핸들러 실행
    onError?.(error, errorInfo, errorId)

    // 성능 모니터링에 에러 보고
    this.reportToPerformanceMonitor(error, componentName)

    // 자동 복구 시작 (설정된 경우)
    this.startAutoRecovery()
  }

  componentWillUnmount() {
    this.mounted = false
    if (this.autoRecoveryTimer) {
      clearTimeout(this.autoRecoveryTimer)
      this.autoRecoveryTimer = undefined
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
  }

  /**
   * 외부 로깅 서비스로 에러 전송 (프로덕션)
   */
  private logErrorToService = (
    error: Error,
    errorInfo: ErrorInfo,
    errorId: string,
    componentName: string
  ) => {
    const errorData = {
      errorId,
      componentName,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      buildVersion: process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown',
    }

    // 실제 로깅 서비스로 전송 (예: Sentry, LogRocket 등)
    // 여기서는 console.error로 대체
    console.error('Error logged to service:', errorData)
  }

  /**
   * 성능 모니터링 시스템에 에러 보고
   */
  private reportToPerformanceMonitor = (error: Error, componentName: string) => {
    // 성능 모니터링 시스템이 있다면 에러 카운트 증가
    if (typeof window !== 'undefined' && (window as any).__PERFORMANCE_MONITOR__) {
      const monitor = (window as any).__PERFORMANCE_MONITOR__
      monitor.reportError?.(error, componentName)
    }
  }

  /**
   * 자동 복구 메커니즘
   */
  private startAutoRecovery = () => {
    const { autoRecoveryTime = 5000, maxRetries = 3 } = this.props

    if (this.state.retryCount < maxRetries && autoRecoveryTime > 0) {
      this.autoRecoveryTimer = setTimeout(() => {
        if (!this.mounted) return
        console.log(`🔄 Auto-recovery attempt ${this.state.retryCount + 1}/${maxRetries}`)
        this.handleReset()
      }, autoRecoveryTime)
    }
  }

  /**
   * 에러 상태 리셋 및 재시도
   */
  private handleReset = () => {
    if (!this.mounted) return
    const newRetryCount = this.state.retryCount + 1

    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      errorId: undefined,
      retryCount: newRetryCount,
    })

    if (process.env.NODE_ENV === 'development') {
      console.log(`🔄 ErrorBoundary reset - Retry count: ${newRetryCount}`)
    }
  }

  /**
   * 수동 리셋 (사용자 액션)
   */
  private handleManualReset = () => {
    if (!this.mounted) return
    this.setState({ retryCount: 0 })
    this.handleReset()
  }

  /**
   * 에러 타입별 커스텀 처리
   */
  private renderCustomErrorHandler = (error: Error): ReactNode | null => {
    const { errorHandlers } = this.props

    if (!errorHandlers) return null

    // 에러 타입이나 메시지를 기반으로 커스텀 핸들러 찾기
    for (const [errorType, handler] of Object.entries(errorHandlers)) {
      if (error.name === errorType || error.message.includes(errorType)) {
        return handler(error)
      }
    }

    return null
  }

  render() {
    if (this.state.hasError && this.state.error) {
      // 커스텀 에러 핸들러 확인
      const customHandler = this.renderCustomErrorHandler(this.state.error)
      if (customHandler) {
        return customHandler
      }

      // 커스텀 fallback 컴포넌트 사용
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback
        return (
          <FallbackComponent
            error={this.state.error}
            errorInfo={this.state.errorInfo}
            errorId={this.state.errorId}
            retryCount={this.state.retryCount}
            reset={this.handleManualReset}
            componentName={this.props.componentName}
          />
        )
      }

      // 기본 fallback UI
      return (
        <DefaultErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          errorId={this.state.errorId}
          retryCount={this.state.retryCount}
          reset={this.handleManualReset}
          componentName={this.props.componentName}
        />
      )
    }

    return this.props.children
  }
}

/**
 * 기본 에러 fallback 컴포넌트
 */
const DefaultErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo,
  errorId,
  retryCount,
  reset,
  componentName,
}) => {
  const isDev = process.env.NODE_ENV === 'development'
  const isMinorError = componentName && ['PerformanceMonitor'].includes(componentName)

  // 경미한 에러 (파티클 등)의 경우 간단한 fallback
  if (isMinorError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-sm rounded-lg">
        <div className="text-center text-white/60 p-4">
          <div className="w-8 h-8 mx-auto mb-2 opacity-40">
            <svg fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <p className="text-sm mb-2">{componentName} 로딩 실패</p>
          <button
            onClick={reset}
            className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded transition-colors"
          >
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  // 전체 페이지 에러 fallback
  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 text-red-600 mr-3">
                <svg fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-red-800">
                {componentName ? `${componentName} 오류` : '페이지 오류가 발생했습니다'}
              </h2>
            </div>

            <p className="text-red-700 mb-4">
              죄송합니다. {componentName ? '컴포넌트를' : '페이지를'} 불러오는 중에 오류가
              발생했습니다.
              {retryCount > 0 && ` (재시도 횟수: ${retryCount})`}
            </p>

            <div className="space-y-3 mb-4">
              <button
                onClick={reset}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors mr-3"
              >
                다시 시도
              </button>
              <button
                onClick={() => window.location.reload()}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors mr-3"
              >
                페이지 새로고침
              </button>
              <button
                onClick={() => (window.location.href = '/')}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              >
                홈으로 돌아가기
              </button>
            </div>

            {/* 개발 환경에서만 상세 정보 표시 */}
            {isDev && error && (
              <details className="mt-4">
                <summary className="text-sm text-red-600 cursor-pointer font-medium">
                  개발자 정보 (에러 ID: {errorId})
                </summary>
                <div className="mt-3 space-y-2">
                  <div>
                    <p className="text-sm font-medium text-red-700">Error Message:</p>
                    <pre className="text-xs text-red-800 bg-red-100 p-2 rounded overflow-auto">
                      {error.message}
                    </pre>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-red-700">Stack Trace:</p>
                    <pre className="text-xs text-red-800 bg-red-100 p-2 rounded overflow-auto max-h-32">
                      {error.stack}
                    </pre>
                  </div>
                  {errorInfo && (
                    <div>
                      <p className="text-sm font-medium text-red-700">Component Stack:</p>
                      <pre className="text-xs text-red-800 bg-red-100 p-2 rounded overflow-auto max-h-32">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ErrorBoundary
export type { ErrorBoundaryProps, ErrorFallbackProps }
