'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useDevicePerformance } from '@/hooks/useDevicePerformance'
import { useRenderPerformance } from '@/hooks/usePerformanceMonitor'
import CSSParticles from './CSSParticles'

// WebGL 컴포넌트를 동적으로 로드 (code splitting)
const LiquidMetalParticles = dynamic(() => import('./LiquidMetalParticles'), {
  ssr: false,
  loading: () => <div className="absolute inset-0" />, // 로딩 중 빈 div
})

interface AdaptiveParticlesProps {
  particleCount: number
  width: number
  height: number
  forceCSS?: boolean // 테스트용 강제 CSS 모드
}

/**
 * 디바이스 성능에 따라 WebGL 또는 CSS 파티클을 선택하는 적응형 컴포넌트
 */
const AdaptiveParticles = ({ particleCount, width, height, forceCSS = false }: AdaptiveParticlesProps) => {
  const { performanceLevel, isMobile, isLowPowerMode } = useDevicePerformance()
  const [useWebGL, setUseWebGL] = useState(false)
  const [webglSupported, setWebglSupported] = useState(true)
  
  // 렌더링 성능 추적
  const renderPerf = useRenderPerformance('AdaptiveParticles')

  // WebGL 지원 확인 - 브라우저 호환성 개선
  const checkWebGLSupport = useCallback(() => {
    // 이미 WebGL 지원 여부를 확인했다면 캐시된 결과 사용
    const cachedSupport = sessionStorage.getItem('webgl-support')
    if (cachedSupport !== null) {
      return cachedSupport === 'true'
    }

    const canvas = document.createElement('canvas')
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null
    
    try {
      // Safari와 Firefox에 최적화된 WebGL 컨텍스트 생성
      const contextOptions: WebGLContextAttributes = {
        alpha: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: true // 성능이 떨어지면 실패
      }
      
      // WebGL2 먼저 시도, 실패시 WebGL1
      gl = canvas.getContext('webgl2', contextOptions) || 
           canvas.getContext('webgl', contextOptions)
    } catch (e) {
      console.warn('WebGL context creation failed:', e)
    }
    
    const supported = !!gl
    
    // Safari 전용 WebGL 컨텍스트 손실 감지
    if (supported && gl) {
      const loseContext = gl.getExtension('WEBGL_lose_context')
      const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
      
      if (loseContext && isSafari) {
        // Safari는 WebGL 컨텍스트 관리가 더 엄격함
        canvas.addEventListener('webglcontextlost', (e) => {
          console.warn('Safari WebGL context lost, disabling WebGL')
          sessionStorage.setItem('webgl-support', 'false')
        })
      }
    }
    
    // 결과 캐싱 (세션 동안 유지)
    sessionStorage.setItem('webgl-support', supported.toString())
    canvas.remove()
    
    return supported
  }, [])

  useEffect(() => {
    if (forceCSS) {
      setUseWebGL(false)
      return
    }

    const supported = checkWebGLSupport()
    setWebglSupported(supported)

    if (!supported) {
      setUseWebGL(false)
      return
    }

    // 성능 기반 렌더링 방식 결정
    const shouldUseWebGL = 
      supported &&
      !isLowPowerMode &&
      (performanceLevel === 'high' || 
       (performanceLevel === 'medium' && !isMobile))

    setUseWebGL(shouldUseWebGL)
  }, [performanceLevel, isMobile, isLowPowerMode, forceCSS, checkWebGLSupport])

  // 성능에 따른 파티클 수 조정 - 메모이제이션으로 최적화
  const optimizedParticleCount = useMemo(() => {
    if (!useWebGL) {
      // CSS 파티클은 최대 120개로 확장
      return Math.min(particleCount, 120)
    }

    // WebGL 파티클 수 조정
    const multipliers = {
      high: 1,
      medium: 0.7,
      low: 0.4
    } as const

    const multiplier = multipliers[performanceLevel] ?? 1
    return Math.floor(particleCount * multiplier)
  }, [particleCount, performanceLevel, useWebGL])

  // 개발 환경에서 로그 출력
  if (process.env.NODE_ENV === 'development') {
    console.log(`AdaptiveParticles: ${useWebGL ? 'WebGL' : 'CSS'} mode, ${optimizedParticleCount} particles, Performance: ${performanceLevel}`)
  }

  if (useWebGL && webglSupported) {
    return (
      <LiquidMetalParticles
        particleCount={optimizedParticleCount}
        width={width}
        height={height}
      />
    )
  }

  return (
    <CSSParticles
      particleCount={optimizedParticleCount}
      width={width}
      height={height}
    />
  )
}

export default AdaptiveParticles