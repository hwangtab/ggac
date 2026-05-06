'use client'

import { useMemo, memo } from 'react'

interface CSSParticlesProps {
  particleCount: number
  width: number
  height: number
}

interface Particle {
  id: number
  x: number
  y: number
  size: number
  duration: number
  delay: number
  direction: 'up' | 'down' | 'left' | 'right'
}

/**
 * WebGL 대신 CSS 애니메이션을 사용하는 경량화된 파티클 시스템
 * 저성능 디바이스나 WebGL을 지원하지 않는 환경에서 사용
 */
const CSSParticles = memo(({ particleCount, width, height }: CSSParticlesProps) => {
  // 파티클 데이터 생성 (성능상 최대 120개로 확장) - 메모리 최적화
  const particles = useMemo(() => {
    // 60개로 상한 — 데스크탑에서 120 → 60으로 절반 감소, Style&Layout 부하 추가 완화.
    // 시각적으로는 충분히 풍성하면서 paint 비용이 크게 떨어짐.
    const maxParticles = Math.min(particleCount, 60)
    const particleArray: Particle[] = []

    // 화면 크기 기반 최적화된 파티클 수
    const densityFactor = Math.min((width * height) / 500000, 1) // 500k 픽셀 기준
    const optimizedCount = Math.floor(maxParticles * densityFactor)

    for (let i = 0; i < optimizedCount; i++) {
      particleArray.push({
        id: i,
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 3 + 2, // 2-5px (GPU 부하 감소)
        duration: Math.random() * 6 + 8, // 8-14초 (더 긴 애니메이션)
        delay: Math.random() * 4, // 0-4초 지연
        direction: ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)] as any,
      })
    }

    return particleArray
  }, [particleCount, width, height])

  // GPU 최적화된 파티클 스타일 - 백드롭 필터 제거
  const getParticleStyle = (particle: Particle) => ({
    position: 'absolute' as const,
    left: `${particle.x}px`,
    top: `${particle.y}px`,
    width: `${particle.size}px`,
    height: `${particle.size}px`,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.7)', // 불투명도 증가로 가시성 보상
    // backdropFilter 제거 - GPU 부하 대폭 감소
    transform: 'translate3d(0, 0, 0)',
    willChange: 'transform, opacity', // GPU 레이어 활성화 유지
    animation: `cssParticleFloat ${particle.duration}s ease-in-out ${particle.delay}s infinite ${
      particle.id % 2 === 0 ? 'normal' : 'reverse'
    }`,
    // 성능 최적화를 위한 추가 속성
    containIntrinsicSize: `${particle.size}px ${particle.size}px`,
    contain: 'layout style paint',
  })

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{
        // backdrop-filter 제거 — Style & Layout 비용이 데스크탑에서 1700ms+ 차지하던 주범
        // (PSI 데스크탑 점수 -22 정도). 미세한 블러/saturate 효과 손실 < 성능 이득.
        // GPU 가속 및 컴포지트 레이어 최적화
        transform: 'translateZ(0)',
        isolation: 'isolate',
        contain: 'layout style paint',
        willChange: 'auto',
      }}
    >
      {particles.map(particle => (
        <div key={particle.id} style={getParticleStyle(particle)} />
      ))}
    </div>
  )
})

CSSParticles.displayName = 'CSSParticles'

export default CSSParticles
