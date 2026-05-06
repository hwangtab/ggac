'use client'

import { useEffect, useState, useCallback, memo } from 'react'
import Link from 'next/link'
import OptimizedHeroImage from './OptimizedHeroImage'
import LazyParticles from './LazyParticles'
import ErrorBoundary from './ErrorBoundary'
import PerformanceMonitor from './PerformanceMonitor'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { useRenderPerformance } from '@/hooks/usePerformanceMonitor'
import { getErrorTracker } from '@/utils/errorTracking'

const Hero = () => {
  const [isLoaded, setIsLoaded] = useState(false)
  const [showText, setShowText] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  // 접근성: 사용자의 동작 줄이기 설정 확인
  const prefersReducedMotion = usePrefersReducedMotion()

  // 렌더링 성능 추적
  const renderPerf = useRenderPerformance('Hero')

  // 모바일 디바이스 감지
  const isMobileDevice = useCallback(() => {
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768 ||
      'ontouchstart' in window
    )
  }, [])

  // 렌더링 최적화: CSS 변수를 직접 DOM에 설정하여 리플로우 최소화
  const updateCSSProperties = useCallback(
    (width: number, height: number) => {
      const root = document.documentElement
      const isMobile = isMobileDevice()

      // CSS 속성 값들을 미리 계산
      const cssProperties = new Map<string, string>()

      // 반응형 그라데이션 크기
      if (width > 1200) {
        cssProperties.set('--gradient-size', '1200px 750px')
        cssProperties.set('--gradient-alpha-start', '0.85')
        cssProperties.set('--gradient-alpha-mid', '0.65')
      } else if (width > 768) {
        cssProperties.set('--gradient-size', '900px 600px')
        cssProperties.set('--gradient-alpha-start', '0.85')
        cssProperties.set('--gradient-alpha-mid', '0.65')
      } else {
        cssProperties.set('--gradient-size', '500px 400px')
        cssProperties.set('--gradient-alpha-start', '0.90')
        cssProperties.set('--gradient-alpha-mid', '0.70')
      }

      // 모바일에서 블러 효과 최적화 (GPU 부하 감소)
      if (isMobile) {
        cssProperties.set('--glassmorphism-blur', width > 768 ? '8px' : '4px')
        cssProperties.set('--glassmorphism-saturation', '150%')
        cssProperties.set('--glassmorphism-bg-alpha', width > 768 ? '0.18' : '0.22')
      } else {
        cssProperties.set('--glassmorphism-blur', width > 768 ? '12px' : '8px')
        cssProperties.set('--glassmorphism-saturation', width > 768 ? '180%' : '160%')
        cssProperties.set('--glassmorphism-bg-alpha', width > 768 ? '0.12' : '0.15')
      }

      // requestAnimationFrame으로 배치 처리하여 리플로우 최소화
      requestAnimationFrame(() => {
        cssProperties.forEach((value, property) => {
          root.style.setProperty(property, value)
        })
      })
    },
    [isMobileDevice]
  )

  // 파티클 수 계산 - 모바일 최적화 강화
  const getOptimalParticleCount = useCallback(
    (width: number, height: number) => {
      const area = width * height
      const isMobile = isMobileDevice()

      // 모바일에서 파티클 수 대폭 감소
      if (isMobile) {
        const mobileDensity = area / 40000 // 모바일: 밀도 대폭 감소
        let mobileCount = Math.min(Math.max(Math.floor(mobileDensity), 20), 60) // 20-60개로 제한

        // 작은 화면에서 더 감소
        if (width < 480) {
          mobileCount = Math.floor(mobileCount * 0.5)
        }

        return Math.min(mobileCount, 40) // 모바일 최대 40개
      }

      // 데스크톱
      const density = area / 15000
      let baseCount = Math.min(Math.max(Math.floor(density), 150), 500)

      // 성능이 좋지 않은 기기 감지
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) {
        baseCount = Math.floor(baseCount * 0.6)
      }

      return Math.min(baseCount, 250)
    },
    [isMobileDevice]
  )

  // Safari 모바일 뷰포트 호환성을 위한 안전한 차원 측정
  const getSafeViewportDimensions = useCallback(() => {
    const isSafariMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)

    if (isSafariMobile && window.visualViewport) {
      return {
        width: window.visualViewport.width,
        height: window.visualViewport.height,
      }
    }

    return {
      width: window.innerWidth,
      height: window.innerHeight,
    }
  }, [])

  // 화면 크기 업데이트 - debounce로 성능 최적화
  const updateDimensions = useCallback(() => {
    const { width, height } = getSafeViewportDimensions()

    // 동일한 크기라면 업데이트 스킵
    if (dimensions.width === width && dimensions.height === height) {
      return
    }

    setDimensions({ width, height })
    updateCSSProperties(width, height)
  }, [getSafeViewportDimensions, updateCSSProperties, dimensions.width, dimensions.height])

  useEffect(() => {
    let mounted = true

    // 에러 추적 시스템 초기화
    if (typeof window !== 'undefined') {
      getErrorTracker()
    }

    // 진입 애니메이션 시퀀스 - 타이밍 최적화
    const timer1 = setTimeout(() => {
      if (mounted) setIsLoaded(true)
    }, 50)
    const timer2 = setTimeout(() => {
      if (mounted) setShowText(true)
    }, 300)

    // 초기 화면 크기 설정
    updateDimensions()

    // 리사이즈 이벤트 리스너 - debounce 함수 내부에서 mounted 체크
    const debouncedResize = debounce(() => {
      if (mounted) updateDimensions()
    }, 250)

    window.addEventListener('resize', debouncedResize, { passive: true })

    return () => {
      mounted = false
      clearTimeout(timer1)
      clearTimeout(timer2)
      window.removeEventListener('resize', debouncedResize)
      // debounce 타이머도 정리
      debouncedResize.cancel()
    }
  }, [updateDimensions])

  return (
    <section
      role="banner"
      aria-label="메인 영역"
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{
        // CSS 컨테인먼트로 렌더링 최적화
        contain: 'layout style paint',
        // 불필요한 willChange 제거
        willChange: 'auto',
      }}
    >
      {/* Layer 1: 배경 이미지 - 최적화된 이미지 컴포넌트 */}
      <div className="absolute inset-0" style={{ zIndex: 1 }}>
        <OptimizedHeroImage
          alt="경기아트콜렉티브 협동조합 창립총회"
          priority
          style={{
            filter: 'contrast(1.1) brightness(1.05)',
            // willChange 제거 - OptimizedHeroImage에서 관리
          }}
        />
      </div>

      {/* Layer 2: 전체 다크 오버레이 - 명도 대비 강화 */}
      <div
        className="absolute inset-0"
        style={{
          zIndex: 10,
          background:
            'linear-gradient(135deg, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0.5) 50%, rgba(0, 0, 0, 0.6) 100%)',
          // 정적 오버레이이므로 GPU 최적화 불필요
        }}
      />

      {/* Layer 3: 중앙 집중형 그라데이션 오버레이 - CSS 커스텀 프로퍼티 활용 */}
      <div
        className="absolute inset-0"
        style={{
          zIndex: 15,
          background: `radial-gradient(
            ellipse var(--gradient-size, 900px 600px) at center,
            rgba(0, 0, 0, var(--gradient-alpha-start, 0.85)) 0%,
            rgba(0, 0, 0, var(--gradient-alpha-mid, 0.65)) 30%,
            rgba(0, 0, 0, 0.4) 60%,
            rgba(0, 0, 0, 0.2) 80%,
            transparent 100%
          )`,
          // 정적 그라데이션이므로 GPU 최적화 불필요
        }}
      />

      {/* Layer 5: 지연 로딩 파티클 애니메이션 - 접근성 및 성능 최적화 */}
      {!prefersReducedMotion && dimensions.width > 0 && dimensions.height > 0 && (
        <div aria-hidden="true">
          <LazyParticles
            particleCount={getOptimalParticleCount(dimensions.width, dimensions.height)}
            width={dimensions.width}
            height={dimensions.height}
            preloadDistance="300px"
            enablePreloading={true}
            priority="high"
          />
        </div>
      )}

      {/* Layer 4: 글래스모피즘 텍스트 컨테이너 */}
      <div className="relative text-center text-white px-4" style={{ zIndex: 20 }}>
        <div
          className={`glass-hero-container max-w-6xl mx-auto rounded-3xl 
            px-6 py-6 sm:px-10 sm:py-8 md:px-12 md:py-9 lg:px-16 lg:py-11
            mx-2 sm:mx-4 md:mx-auto
            rounded-2xl sm:rounded-3xl
            ${
              prefersReducedMotion
                ? 'opacity-100'
                : `transition-all duration-800 ease-out ${
                    isLoaded
                      ? 'opacity-100 translate-y-0 scale-100'
                      : 'opacity-0 translate-y-3 scale-98'
                  }`
            }`}
          style={{
            backdropFilter: isLoaded
              ? `blur(var(--glassmorphism-blur, 12px)) saturate(var(--glassmorphism-saturation, 180%))`
              : 'blur(0px)',
            background: isLoaded
              ? `linear-gradient(
              135deg,
              rgba(255, 255, 255, var(--glassmorphism-bg-alpha, 0.12)) 0%,
              rgba(255, 255, 255, calc(var(--glassmorphism-bg-alpha, 0.12) * 0.67)) 50%,
              rgba(255, 255, 255, calc(var(--glassmorphism-bg-alpha, 0.12) * 0.42)) 100%
            )`
              : 'transparent',
            border: isLoaded ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid transparent',
            boxShadow: isLoaded
              ? `
              0 8px 32px rgba(0, 0, 0, 0.3),
              0 2px 16px rgba(0, 0, 0, 0.2),
              inset 0 1px 0 rgba(255, 255, 255, 0.1)
            `
              : 'none',
            willChange: 'transform',
            transform: 'translateZ(0)',
          }}
        >
          <h1
            className={`tw-heading-primary mb-4 sm:mb-6 ${
              prefersReducedMotion
                ? 'opacity-100'
                : `transition-all duration-600 ease-out delay-200 ${
                    showText ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                  }`
            }`}
            style={{
              color: '#FFFFFF',
              textShadow: `
                0 3px 6px rgba(0, 0, 0, 0.8),
                0 1px 3px rgba(0, 0, 0, 0.7)
              `,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            <span className="block">틀을 깨는 소리</span>
            <span className="block">함께 쌓는 무대</span>
          </h1>
          <p
            className={`text-lg sm:text-xl md:text-2xl mb-6 sm:mb-8 max-w-2xl mx-auto leading-relaxed ${
              prefersReducedMotion
                ? 'opacity-100'
                : `transition-all duration-600 ease-out delay-300 ${
                    showText ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                  }`
            }`}
            style={{
              color: 'rgba(255, 255, 255, 0.92)',
              textShadow: `
                0 2px 4px rgba(0, 0, 0, 0.7),
                0 1px 3px rgba(0, 0, 0, 0.6)
              `,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              lineHeight: 1.4,
            }}
          >
            실험과 연대로 새로운 예술 생태계를 만드는
            <br />
            경기아트콜렉티브
          </p>
          <div
            className={`flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center ${
              prefersReducedMotion
                ? 'opacity-100'
                : `transition-all duration-600 ease-out delay-400 ${
                    showText ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                  }`
            }`}
          >
            <Link
              href="/about"
              className={`btn-glass-primary px-8 py-4 sm:px-8 sm:py-3 rounded-xl font-medium text-base sm:text-base w-full sm:w-auto text-center min-h-[44px] flex items-center justify-center ${
                prefersReducedMotion
                  ? 'hover:brightness-110'
                  : 'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl hover:brightness-110'
              }`}
              style={{
                background: `linear-gradient(
                  135deg,
                  rgba(255, 255, 255, 0.25) 0%,
                  rgba(255, 255, 255, 0.15) 100%
                )`,
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                color: 'white',
                boxShadow: `
                  0 4px 16px rgba(0, 0, 0, 0.2),
                  inset 0 1px 0 rgba(255, 255, 255, 0.2)
                `,
              }}
            >
              우리의 이야기
            </Link>
            <Link
              href="/connect"
              className={`btn-glass-secondary px-8 py-4 sm:px-8 sm:py-3 rounded-xl font-medium text-base sm:text-base w-full sm:w-auto text-center min-h-[44px] flex items-center justify-center ${
                prefersReducedMotion
                  ? 'hover:bg-white/10 hover:border-white/60'
                  : 'transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/10 hover:border-white/60'
              }`}
              style={{
                background: 'transparent',
                backdropFilter: 'blur(4px)',
                border: '2px solid rgba(255, 255, 255, 0.4)',
                color: 'rgba(255, 255, 255, 0.9)',
                boxShadow: `
                  0 4px 16px rgba(0, 0, 0, 0.15),
                  inset 0 1px 0 rgba(255, 255, 255, 0.1)
                `,
              }}
            >
              조합 가입하기
            </Link>
          </div>
        </div>
      </div>

      <div
        className={`absolute bottom-8 left-0 right-0 flex justify-center text-white ${
          prefersReducedMotion ? '' : 'animate-bounce'
        }`}
      >
        <div className="w-6 h-10 border-2 border-white rounded-full flex justify-center">
          <div
            className={`w-1 h-3 bg-white rounded-full mt-2 ${
              prefersReducedMotion ? '' : 'animate-pulse'
            }`}
          />
        </div>
      </div>

      {/* 성능 모니터 - 개발 환경에서만 표시 */}
      <PerformanceMonitor
        position="top-right"
        mode="compact"
        devOnly={true}
        showOnlyWhenLowPerf={false}
      />
    </section>
  )
}

// 유틸리티 함수 - 취소 기능이 있는 debounce
function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): T & { cancel: () => void } {
  let timeoutId: NodeJS.Timeout | null = null

  const debounced = ((...args: any[]) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      timeoutId = null
      func(...args)
    }, delay)
  }) as T & { cancel: () => void }

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced
}

export default memo(Hero)
