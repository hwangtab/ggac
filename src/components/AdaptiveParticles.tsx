'use client'

import { useEffect, useState, useMemo, useCallback, memo, useRef } from 'react'
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
  
  // WebGL 초기화 방지를 위한 ref
  const webglInitializedRef = useRef(false)
  const previousPropsRef = useRef({ particleCount, width, height, forceCSS })
  
  // 렌더링 성능 추적
  const renderPerf = useRenderPerformance('AdaptiveParticles')

  // Props 변경 감지 및 안정화
  const propsChanged = useMemo(() => {
    const prev = previousPropsRef.current
    const changed = prev.particleCount !== particleCount || 
                   prev.width !== width || 
                   prev.height !== height || 
                   prev.forceCSS !== forceCSS
    
    if (changed) {
      previousPropsRef.current = { particleCount, width, height, forceCSS }
    }
    
    return changed
  }, [particleCount, width, height, forceCSS])

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

  // 파티클 시스템 선택 로직을 useCallback으로 메모이제이션
  const selectParticleSystem = useCallback(() => {
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

  useEffect(() => {
    // 이미 초기화되었고 props가 변경되지 않았다면 스킵
    if (webglInitializedRef.current && !propsChanged) {
      return
    }

    selectParticleSystem()
    webglInitializedRef.current = true
  }, [selectParticleSystem, propsChanged])

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

AdaptiveParticles.displayName = 'AdaptiveParticles'

export default memo(AdaptiveParticles, (prevProps, nextProps) => {
  // shallow compare for props to prevent unnecessary re-renders
  return (
    prevProps.particleCount === nextProps.particleCount &&
    prevProps.width === nextProps.width &&
    prevProps.height === nextProps.height &&
    prevProps.forceCSS === nextProps.forceCSS
  )
})