'use client'

import { useState, useEffect, ComponentType, Suspense, memo, useMemo, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useLazyLoading } from '@/hooks/useIntersectionObserver'
import { useRenderPerformance } from '@/hooks/usePerformanceMonitor'
import ErrorBoundary from './ErrorBoundary'

// 타입 정의
interface ParticleProps {
  particleCount: number
  width: number
  height: number
  forceCSS?: boolean
}

interface LazyParticlesProps extends ParticleProps {
  // 지연 로딩 옵션
  preloadDistance?: string
  loadingComponent?: React.ComponentType
  fallbackComponent?: React.ComponentType
  // 성능 옵션
  enablePreloading?: boolean
  priority?: 'high' | 'low'
}

// 동적 임포트 - 실제 필요할 때만 로딩
const AdaptiveParticles = dynamic(() => import('./AdaptiveParticles'), {
  ssr: false,
  loading: () => <ParticlesLoadingSkeleton />,
})

/**
 * 로딩 스켈레톤 컴포넌트
 * 파티클이 로딩되는 동안 표시할 플레이스홀더
 */
const ParticlesLoadingSkeleton = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    <div className="animate-pulse duration-2000">
      {/* 미묘한 점들로 로딩 상태 표시 */}
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 bg-white/10 rounded-full animate-pulse"
          style={{
            left: `${15 + (i * 7) % 70}%`,
            top: `${25 + (i * 11) % 50}%`,
            animationDelay: `${i * 0.15}s`,
            animationDuration: `${2 + (i % 3) * 0.5}s`,
          }}
        />
      ))}
    </div>
  </div>
)

/**
 * 파티클 로딩 실패 시 표시할 fallback 컴포넌트
 */
const ParticlesFallback = () => {
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    // 3초 후에 간단한 CSS 애니메이션 표시
    const timer = setTimeout(() => setShowFallback(true), 3000)
    return () => clearTimeout(timer)
  }, [])

  if (!showFallback) return null

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* 초경량 CSS 기반 파티클 */}
      <div className="floating-dots">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 bg-white/30 rounded-full"
            style={{
              left: `${20 + i * 8}%`,
              top: `${30 + (i % 3) * 15}%`,
              animation: `cssParticleFloat ${4 + i}s ease-in-out infinite`,
              animationDelay: `${i * 0.5}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 지연 로딩되는 파티클 시스템
 * Intersection Observer를 사용하여 뷰포트에 진입할 때만 파티클 코드를 로딩
 */
const LazyParticles = memo(({
  particleCount,
  width,
  height,
  forceCSS = false,
  preloadDistance = '200px',
  loadingComponent: LoadingComponent = ParticlesLoadingSkeleton,
  fallbackComponent: FallbackComponent = ParticlesFallback,
  enablePreloading = true,
  priority = 'low',
}: LazyParticlesProps) => {
  // 참조를 안정화하여 불필요한 리렌더링 방지
  const stableOptionsRef = useRef({
    rootMargin: enablePreloading ? preloadDistance : '0px',
    threshold: 0.1,
  })

  // Intersection Observer로 지연 로딩 관리
  const { shouldLoad, targetRef } = useLazyLoading(stableOptionsRef.current)

  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [ParticleComponent, setParticleComponent] = useState<ComponentType<ParticleProps> | null>(null)
  
  // 렌더링 성능 추적 - 컴포넌트 이름 안정화
  const renderPerf = useRenderPerformance('LazyParticles')

  // 파티클 props를 memoize하여 불필요한 리렌더링 방지
  const stableParticleProps = useMemo(() => ({
    particleCount,
    width,
    height,
    forceCSS,
  }), [particleCount, width, height, forceCSS])

  // 파티클 컴포넌트 동적 로딩을 useCallback으로 최적화
  const loadParticleComponent = useCallback(async () => {
    if (ParticleComponent || isLoading) return

    // 이미 AdaptiveParticles가 로드되어 있다면 바로 사용
    if (typeof window !== 'undefined' && (window as any).__ADAPTIVE_PARTICLES_LOADED__) {
      setParticleComponent(() => AdaptiveParticles)
      return
    }

    setIsLoading(true)
    setLoadError(null)

    const loadStartTime = performance.now()

    try {
      // 동적 임포트 시도
      const dynamicModule = await import('./AdaptiveParticles')
      const loadTime = performance.now() - loadStartTime
      
      // 개발 환경에서 로딩 시간 로그
      if (process.env.NODE_ENV === 'development') {
        console.log(`🎉 AdaptiveParticles loaded in ${loadTime.toFixed(2)}ms`)
      }

      // 글로벌 플래그 설정 (중복 로딩 방지)
      if (typeof window !== 'undefined') {
        (window as any).__ADAPTIVE_PARTICLES_LOADED__ = true
      }

      setParticleComponent(() => dynamicModule.default)
      setIsLoading(false)
    } catch (error) {
      console.error('Failed to load AdaptiveParticles:', error)
      setLoadError(error)
      setIsLoading(false)
    }
  }, [ParticleComponent, isLoading])

  useEffect(() => {
    if (shouldLoad) {
      loadParticleComponent()
    }
  }, [shouldLoad, loadParticleComponent])

  // 프리로딩 힌트 (high priority인 경우) - 더 안전한 방식
  useEffect(() => {
    if (priority === 'high' && shouldLoad && !ParticleComponent) {
      // 컴포넌트 프리로딩 (브라우저가 자동으로 청크 경로 해결)
      import('./AdaptiveParticles').catch(() => {
        // 프리로딩 실패는 무시 (실제 로딩 시에 다시 시도)
      })
    }
  }, [priority, shouldLoad, ParticleComponent])

  return (
    <div 
      ref={targetRef} 
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 30 }}
    >
      {/* 로딩 상태 */}
      {isLoading && <LoadingComponent />}
      
      {/* 에러 상태 */}
      {loadError && <FallbackComponent />}
      
      {/* 로딩 완료 */}
      {ParticleComponent && !isLoading && !loadError && (
        <ErrorBoundary 
          componentName="LazyParticles"
          maxRetries={2}
          autoRecoveryTime={3000}
          fallback={({ error, reset, retryCount, componentName }) => (
            <div className="absolute inset-0 flex items-center justify-center bg-black/5 backdrop-blur-sm rounded-lg">
              <div className="text-center text-white/50 p-4">
                <div className="w-6 h-6 mx-auto mb-2 opacity-50">
                  <svg fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <p className="text-xs mb-2">파티클 렌더링 오류</p>
                {retryCount < 2 && (
                  <button
                    onClick={reset}
                    className="text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded transition-colors"
                  >
                    다시 시도 ({retryCount + 1}/2)
                  </button>
                )}
                {retryCount >= 2 && (
                  <p className="text-xs opacity-75">자동 복구 실패</p>
                )}
              </div>
            </div>
          )}
          onError={(error, errorInfo, errorId) => {
            console.warn(`LazyParticles error (${errorId}):`, error.message)
          }}
        >
          <Suspense fallback={<LoadingComponent />}>
            <ParticleComponent {...stableParticleProps} />
          </Suspense>
        </ErrorBoundary>
      )}
      
      {/* 개발 환경 디버깅 정보 */}
      {process.env.NODE_ENV === 'development' && (
        <div 
          className="absolute top-2 left-2 text-xs text-white/50 font-mono pointer-events-none"
          style={{ zIndex: 100 }}
        >
          <div>Lazy: {shouldLoad ? '✅' : '⏳'}</div>
          <div>Loading: {isLoading ? '🔄' : '✅'}</div>
          <div>Component: {ParticleComponent ? '✅' : '❌'}</div>
          <div>Renders: {renderPerf.renderCount}</div>
          <div>Avg Render: {renderPerf.avgRenderTime.toFixed(1)}ms</div>
          {loadError && <div className="text-red-400">Error: {loadError.message}</div>}
        </div>
      )}
    </div>
  )
})

LazyParticles.displayName = 'LazyParticles'

export default LazyParticles
export { ParticlesLoadingSkeleton, ParticlesFallback }