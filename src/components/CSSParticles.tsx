'use client'

import { useMemo } from 'react'

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
const CSSParticles = ({ particleCount, width, height }: CSSParticlesProps) => {
  // 파티클 데이터 생성 (성능상 최대 120개로 확장)
  const particles = useMemo(() => {
    const maxParticles = Math.min(particleCount, 120)
    const particleArray: Particle[] = []

    for (let i = 0; i < maxParticles; i++) {
      particleArray.push({
        id: i,
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 4 + 3, // 3-7px (더 크게)
        duration: Math.random() * 8 + 6, // 6-14초
        delay: Math.random() * 3, // 0-3초 지연
        direction: ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)] as any,
      })
    }

    return particleArray
  }, [particleCount, width, height])

  // 인라인 스타일로 애니메이션 정의
  const getParticleStyle = (particle: Particle) => ({
    position: 'absolute' as const,
    left: `${particle.x}px`,
    top: `${particle.y}px`,
    width: `${particle.size}px`,
    height: `${particle.size}px`,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.6)',
    backdropFilter: 'blur(2px)',
    transform: 'translate3d(0, 0, 0)',
    willChange: 'transform, opacity',
    animation: `cssParticleFloat ${particle.duration}s ease-in-out ${particle.delay}s infinite ${
      particle.id % 2 === 0 ? 'normal' : 'reverse'
    }`,
  })

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((particle) => (
        <div
          key={particle.id}
          style={getParticleStyle(particle)}
        />
      ))}
    </div>
  )
}

export default CSSParticles