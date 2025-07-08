'use client'

import { useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

const Hero = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mousePosition = useRef({ x: 0, y: 0 })
  const animationFrameId = useRef<number | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const shootingStarsRef = useRef<ShootingStar[]>([])
  const lastFrameTime = useRef(0)

  // 성능 최적화: throttle된 마우스 이벤트 핸들러
  const throttledMouseMove = useCallback((event: MouseEvent) => {
    const now = Date.now()
    if (!lastFrameTime.current || now - lastFrameTime.current >= 16) {
      mousePosition.current = { x: event.clientX, y: event.clientY }
      lastFrameTime.current = now
    }
  }, [])

  interface Particle {
    x: number; y: number; z: number; vx: number; vy: number;
    size: number; alpha: number; twinkleSpeed: number; twinklePhase: number;
  }

  interface ShootingStar {
    x: number; y: number; vx: number; vy: number; size: number;
    alpha: number; length: number; life: number;
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let particles: Particle[] = []
    let shootingStars: ShootingStar[] = []

    // 성능 최적화: 디바이스별 파티클 수 동적 조정
    const getOptimalParticleCount = (width: number, height: number) => {
      const area = width * height
      const density = area / 15000 // 밀도 조정
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      
      // 화면 크기와 기기 성능에 따라 파티클 수 조정
      let baseCount = Math.min(Math.max(Math.floor(density), 50), 200)
      
      // 고해상도 디스플레이에서는 파티클 수 약간 증가
      if (devicePixelRatio > 1) {
        baseCount = Math.floor(baseCount * 1.2)
      }
      
      // 성능이 좋지 않은 기기 감지 (대략적)
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) {
        baseCount = Math.floor(baseCount * 0.7)
      }
      
      return Math.min(baseCount, 150) // 최대 150개로 제한
    }

    const setupAnimation = () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
        animationFrameId.current = null
      }

      // 모바일에서는 애니메이션 비활성화
      if (window.innerWidth < 768) {
        window.removeEventListener('mousemove', throttledMouseMove)
        return
      }

      // 성능 최적화: 고해상도 디스플레이 대응
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const width = window.innerWidth
      const height = window.innerHeight
      
      canvas.width = width * pixelRatio
      canvas.height = height * pixelRatio
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      
      ctx.scale(pixelRatio, pixelRatio)
      
      window.addEventListener('mousemove', throttledMouseMove, { passive: true })

      // 성능 최적화: 파티클 수 동적 조정
      const numParticles = getOptimalParticleCount(width, height)
      
      particles = []
      shootingStars = []

      for (let i = 0; i < numParticles; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          z: Math.random() * width,
          vx: (Math.random() - 0.5) * 0.1,
          vy: (Math.random() - 0.5) * 0.1,
          size: Math.random() * 1.5 + 0.5,
          alpha: 0,
          twinkleSpeed: Math.random() * 0.03 + 0.01,
          twinklePhase: Math.random() * Math.PI * 2,
        })
      }

      // 성능 최적화: 유성 생성 빈도 조정
      const createShootingStar = () => {
        const maxStars = width > 1200 ? 3 : 2 // 화면 크기에 따라 최대 유성 수 조정
        if (Math.random() < 0.003 && shootingStars.length < maxStars) {
          const fromLeft = Math.random() > 0.5
          shootingStars.push({
            x: fromLeft ? 0 : width,
            y: Math.random() * height * 0.6,
            vx: (fromLeft ? 1 : -1) * (Math.random() * 8 + 8),
            vy: Math.random() * 4 + 2,
            size: Math.random() * 1.5 + 1,
            alpha: 1,
            length: Math.random() * 120 + 80,
            life: 80,
          })
        }
      }

      // 성능 최적화: RAF 최적화 및 60fps 타겟팅
      const targetFPS = 60
      const targetFrameTime = 1000 / targetFPS

      const animate = (currentTime: number) => {
        // 프레임 레이트 제한
        if (currentTime - lastFrameTime.current < targetFrameTime) {
          animationFrameId.current = requestAnimationFrame(animate)
          return
        }
        lastFrameTime.current = currentTime

        ctx.clearRect(0, 0, width, height)
        
        // 성능 최적화: parallax 계산 최적화
        const parallaxX = (mousePosition.current.x - width * 0.5) * 0.025
        const parallaxY = (mousePosition.current.y - height * 0.5) * 0.025

        // 성능 최적화: 파티클 렌더링 최적화
        ctx.fillStyle = 'rgba(147, 197, 253, 0.8)'
        
        particles.forEach(p => {
          p.z -= 0.3 // 속도 약간 감소
          if (p.z <= 0) {
            p.x = Math.random() * width
            p.y = Math.random() * height
            p.z = width
          }
          
          const scale = width / (width + p.z)
          const x2d = p.x * scale + (width * 0.5) * (1 - scale) + parallaxX * scale
          const y2d = p.y * scale + (height * 0.5) * (1 - scale) + parallaxY * scale
          const size = p.size * scale
          
          p.twinklePhase += p.twinkleSpeed
          const twinkle = Math.abs(Math.sin(p.twinklePhase))
          p.alpha = Math.max(0, Math.min(1, p.alpha + 0.05 * (twinkle > 0.5 ? 1 : -1)))
          
          // 성능 최적화: globalAlpha를 사용하여 fillStyle 설정 최소화
          ctx.globalAlpha = p.alpha * 0.8
          ctx.beginPath()
          ctx.arc(x2d, y2d, size, 0, Math.PI * 2)
          ctx.fill()
          
          p.x += p.vx
          p.y += p.vy
          if (p.x < 0 || p.x > width) p.vx *= -1
          if (p.y < 0 || p.y > height) p.vy *= -1
        })

        ctx.globalAlpha = 1

        createShootingStar()
        
        // 성능 최적화: 유성 렌더링 개선
        shootingStars.forEach((s, index) => {
          s.x += s.vx
          s.y += s.vy
          s.life -= 1
          s.alpha = s.life / 80
          
          if (s.life <= 0) {
            shootingStars.splice(index, 1)
            return
          }
          
          const gradient = ctx.createLinearGradient(
            s.x, s.y, 
            s.x - s.vx * (s.length / s.vx), 
            s.y - s.vy * (s.length / s.vx)
          )
          gradient.addColorStop(0, `rgba(255, 255, 255, ${s.alpha})`)
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
          
          ctx.strokeStyle = gradient
          ctx.lineWidth = s.size
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(s.x - s.vx * (s.length / s.vx), s.y - s.vy * (s.length / s.vx))
          ctx.stroke()
        })

        animationFrameId.current = requestAnimationFrame(animate)
      }
      
      animate(0)
    }

    // 성능 최적화: 리사이즈 이벤트 debounce
    const debouncedResize = debounce(setupAnimation, 250)
    window.addEventListener('resize', debouncedResize, { passive: true })
    setupAnimation()

    return () => {
      window.removeEventListener('resize', debouncedResize)
      window.removeEventListener('mousemove', throttledMouseMove)
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [throttledMouseMove])

  return (
    <section 
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #1e293b 100%)' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full hidden md:block"
        style={{ 
          willChange: 'transform', // GPU 가속 힌트
          transform: 'translate3d(0, 0, 0)' // GPU 레이어 강제 생성
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-primary-900/30 to-accent-900/30 mix-blend-soft-light" />

      <div className="relative z-10 text-center text-white px-4">
        <h1 className="heading-primary mb-6 animate-fade-in">
          경계 없는 상상,<br />
          함께 만드는 울림
        </h1>
        <p className="text-xl md:text-2xl mb-8 max-w-2xl mx-auto leading-relaxed animate-slide-up">
          예술로 숨 쉬고, 협동으로 길을 내는<br />
          경기아트콜렉티브 협동조합
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-slide-up">
          <Link 
            href="/about"
            className="btn-primary bg-white text-gray-900 hover:bg-gray-100"
          >
            우리의 이야기
          </Link>
          <Link 
            href="/connect"
            className="btn-secondary border-white text-white hover:bg-white/10"
          >
            조합 가입하기
          </Link>
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

// 성능 최적화: 유틸리티 함수들
function throttle<T extends (...args: any[]) => any>(func: T, limit: number): T {
  let inThrottle: boolean
  return ((...args: any[]) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => inThrottle = false, limit)
    }
  }) as T
}

function debounce<T extends (...args: any[]) => any>(func: T, delay: number): T {
  let timeoutId: NodeJS.Timeout
  return ((...args: any[]) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), delay)
  }) as T
}

export default Hero
