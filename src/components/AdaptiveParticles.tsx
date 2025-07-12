'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useDevicePerformance } from '@/hooks/useDevicePerformance'
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

  // WebGL 지원 확인
  useEffect(() => {
    if (forceCSS) {
      setUseWebGL(false)
      return
    }

    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    
    if (!gl) {
      setWebglSupported(false)
      setUseWebGL(false)
      return
    }

    // 성능 기반 렌더링 방식 결정
    const shouldUseWebGL = 
      webglSupported &&
      !isLowPowerMode &&
      (performanceLevel === 'high' || 
       (performanceLevel === 'medium' && !isMobile))

    setUseWebGL(shouldUseWebGL)

    // 정리
    canvas.remove()
  }, [performanceLevel, isMobile, isLowPowerMode, webglSupported, forceCSS])

  // 성능에 따른 파티클 수 조정
  const getOptimizedParticleCount = (): number => {
    if (!useWebGL) {
      // CSS 파티클은 최대 120개로 확장
      return Math.min(particleCount, 120)
    }

    // WebGL 파티클 수 조정
    switch (performanceLevel) {
      case 'high':
        return particleCount
      case 'medium':
        return Math.floor(particleCount * 0.7)
      case 'low':
        return Math.floor(particleCount * 0.4)
      default:
        return particleCount
    }
  }

  const optimizedParticleCount = getOptimizedParticleCount()

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