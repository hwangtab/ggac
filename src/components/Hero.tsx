'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import OptimizedHeroImage from './OptimizedHeroImage'
import LiquidMetalParticles from './LiquidMetalParticles'

const Hero = () => {
  const [isLoaded, setIsLoaded] = useState(false)
  const [showText, setShowText] = useState(false)
  const [cssProperties, setCssProperties] = useState<{[key: string]: string}>({})
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  
  // CSS 커스텀 프로퍼티 업데이트
  const updateCSSProperties = useCallback((width: number, height: number) => {
    const properties: {[key: string]: string} = {}
    
    // 반응형 그라데이션 크기
    if (width > 1200) {
      properties['--gradient-size'] = '1200px 750px'
      properties['--gradient-alpha-start'] = '0.85'
      properties['--gradient-alpha-mid'] = '0.65'
    } else if (width > 768) {
      properties['--gradient-size'] = '900px 600px'
      properties['--gradient-alpha-start'] = '0.85'
      properties['--gradient-alpha-mid'] = '0.65'
    } else {
      properties['--gradient-size'] = '500px 400px'
      properties['--gradient-alpha-start'] = '0.90'
      properties['--gradient-alpha-mid'] = '0.70'
    }
    
    // 글래스모피즘 블러 강도
    properties['--glassmorphism-blur'] = width > 768 ? '12px' : '8px'
    properties['--glassmorphism-saturation'] = width > 768 ? '180%' : '160%'
    properties['--glassmorphism-bg-alpha'] = width > 768 ? '0.12' : '0.15'
    
    setCssProperties(properties)
  }, [])

  // 파티클 수 계산
  const getOptimalParticleCount = useCallback((width: number, height: number) => {
    const area = width * height
    const density = area / 15000 // Phase 2: 밀도 증가로 더 많은 파티클
    let baseCount = Math.min(Math.max(Math.floor(density), 150), 500) // 80-300 → 150-500
    
    // 성능이 좋지 않은 기기 감지
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) {
      baseCount = Math.floor(baseCount * 0.6)
    }
    
    return Math.min(baseCount, 250) // WebGL 최대 250개
  }, [])

  // 화면 크기 업데이트
  const updateDimensions = useCallback(() => {
    const width = window.innerWidth
    const height = window.innerHeight
    setDimensions({ width, height })
    updateCSSProperties(width, height)
  }, [updateCSSProperties])

  useEffect(() => {
    // 진입 애니메이션 시퀀스
    const timer1 = setTimeout(() => setIsLoaded(true), 100)
    const timer2 = setTimeout(() => setShowText(true), 600)
    
    // 초기 화면 크기 설정
    updateDimensions()
    
    // 리사이즈 이벤트 리스너
    const debouncedResize = debounce(updateDimensions, 250)
    window.addEventListener('resize', debouncedResize, { passive: true })

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      window.removeEventListener('resize', debouncedResize)
    }
  }, [updateDimensions])

  return (
    <section 
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={cssProperties}
    >
      {/* Layer 1: 배경 이미지 - 최적화된 이미지 컴포넌트 */}
      <div className="absolute inset-0" style={{ zIndex: 1 }}>
        <OptimizedHeroImage
          alt="경기아트콜렉티브 협동조합 창립총회"
          priority
          style={{ 
            filter: 'contrast(1.1) brightness(1.05)',
            willChange: 'transform',
            backfaceVisibility: 'hidden'
          }}
        />
      </div>
      
      {/* Layer 2: 전체 다크 오버레이 */}
      <div 
        className="absolute inset-0"
        style={{ 
          zIndex: 10,
          background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.3) 50%, rgba(0, 0, 0, 0.4) 100%)',
          willChange: 'transform',
          backfaceVisibility: 'hidden'
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
          willChange: 'transform',
          backfaceVisibility: 'hidden'
        }}
      />
      
      {/* Layer 5: 액체 금속 파티클 애니메이션 - 중력과 자력의 물리 시뮬레이션 */}
      {dimensions.width > 0 && dimensions.height > 0 && (
        <div className="absolute inset-0" style={{ zIndex: 30, pointerEvents: 'none' }}>
          <LiquidMetalParticles
            particleCount={Math.min(getOptimalParticleCount(dimensions.width, dimensions.height), 120)}
            width={dimensions.width}
            height={dimensions.height}
          />
        </div>
      )}

      {/* Layer 4: 글래스모피즘 텍스트 컨테이너 */}
      <div className="relative text-center text-white px-4" style={{ zIndex: 20 }}>
        <div 
          className={`glass-hero-container max-w-6xl mx-auto rounded-3xl transition-all duration-1200 ease-out
            px-6 py-6 sm:px-10 sm:py-8 md:px-12 md:py-9 lg:px-16 lg:py-11
            mx-2 sm:mx-4 md:mx-auto
            rounded-2xl sm:rounded-3xl
            ${
            isLoaded 
              ? 'opacity-100 translate-y-0 scale-100' 
              : 'opacity-0 translate-y-5 scale-95'
          }`}
          style={{
            backdropFilter: isLoaded ? `blur(var(--glassmorphism-blur, 12px)) saturate(var(--glassmorphism-saturation, 180%))` : 'blur(0px)',
            background: isLoaded ? `linear-gradient(
              135deg,
              rgba(255, 255, 255, var(--glassmorphism-bg-alpha, 0.12)) 0%,
              rgba(255, 255, 255, calc(var(--glassmorphism-bg-alpha, 0.12) * 0.67)) 50%,
              rgba(255, 255, 255, calc(var(--glassmorphism-bg-alpha, 0.12) * 0.42)) 100%
            )` : 'transparent',
            border: isLoaded ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid transparent',
            boxShadow: isLoaded ? `
              0 8px 32px rgba(0, 0, 0, 0.3),
              0 2px 16px rgba(0, 0, 0, 0.2),
              inset 0 1px 0 rgba(255, 255, 255, 0.1)
            ` : 'none',
            willChange: 'transform',
            transform: 'translateZ(0)'
          }}
        >
          <h1 
            className={`heading-primary mb-4 sm:mb-6 transition-all duration-1000 ease-out delay-300 ${
              showText 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 translate-y-4'
            }`}
            style={{
              color: 'rgba(255, 255, 255, 0.95)',
              textShadow: `
                0 2px 4px rgba(0, 0, 0, 0.8),
                0 1px 2px rgba(0, 0, 0, 0.6)
              `,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.2
            }}
          >
            경계 없는 상상,<br />
            함께 만드는 울림
          </h1>
          <p 
            className={`text-lg sm:text-xl md:text-2xl mb-6 sm:mb-8 max-w-2xl mx-auto leading-relaxed transition-all duration-1000 ease-out delay-500 ${
              showText 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 translate-y-4'
            }`}
            style={{
              color: 'rgba(255, 255, 255, 0.85)',
              textShadow: `
                0 1px 3px rgba(0, 0, 0, 0.7),
                0 1px 2px rgba(0, 0, 0, 0.5)
              `,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              lineHeight: 1.4
            }}
          >
            예술로 숨 쉬고, 협동으로 길을 내는<br />
            경기아트콜렉티브 협동조합
          </p>
          <div className={`flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center transition-all duration-1000 ease-out delay-700 ${
              showText 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 translate-y-4'
            }`}>
            <Link 
              href="/about"
              className="btn-glass-primary px-6 py-2.5 sm:px-8 sm:py-3 rounded-xl font-medium transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl text-sm sm:text-base w-full sm:w-auto text-center hover:brightness-110"
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
                `
              }}
            >
              우리의 이야기
            </Link>
            <Link 
              href="/connect"
              className="btn-glass-secondary px-6 py-2.5 sm:px-8 sm:py-3 rounded-xl font-medium transition-all duration-300 hover:-translate-y-0.5 text-sm sm:text-base w-full sm:w-auto text-center hover:bg-white/10 hover:border-white/60"
              style={{
                background: 'transparent',
                backdropFilter: 'blur(4px)',
                border: '2px solid rgba(255, 255, 255, 0.4)',
                color: 'rgba(255, 255, 255, 0.9)',
                boxShadow: `
                  0 4px 16px rgba(0, 0, 0, 0.15),
                  inset 0 1px 0 rgba(255, 255, 255, 0.1)
                `
              }}
            >
              조합 가입하기
            </Link>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-0 right-0 flex justify-center text-white animate-bounce">
        <div className="w-6 h-10 border-2 border-white rounded-full flex justify-center">
          <div className="w-1 h-3 bg-white rounded-full mt-2 animate-pulse" />
        </div>
      </div>
    </section>
  )
}

// 유틸리티 함수
function debounce<T extends (...args: any[]) => any>(func: T, delay: number): T {
  let timeoutId: NodeJS.Timeout
  return ((...args: any[]) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), delay)
  }) as T
}

export default Hero