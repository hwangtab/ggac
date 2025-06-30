'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

const Hero = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mousePosition = useRef({ x: 0, y: 0 })
  const animationFrameId = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const handleMouseMove = (event: MouseEvent) => {
      mousePosition.current = { x: event.clientX, y: event.clientY }
    }

    interface Particle {
      x: number; y: number; z: number; vx: number; vy: number;
      size: number; alpha: number; twinkleSpeed: number; twinklePhase: number;
    }

    interface ShootingStar {
      x: number; y: number; vx: number; vy: number; size: number;
      alpha: number; length: number; life: number;
    }

    let particles: Particle[] = []
    let shootingStars: ShootingStar[] = []

    const setupAnimation = () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
        animationFrameId.current = null
      }

      // 모바일에서는 애니메이션 비활성화
      if (window.innerWidth < 768) {
        window.removeEventListener('mousemove', handleMouseMove)
        return
      }

      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      window.addEventListener('mousemove', handleMouseMove)

      particles = []
      shootingStars = []
      const numParticles = 150

      for (let i = 0; i < numParticles; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          z: Math.random() * canvas.width,
          vx: (Math.random() - 0.5) * 0.1,
          vy: (Math.random() - 0.5) * 0.1,
          size: Math.random() * 1.5 + 0.5,
          alpha: 0,
          twinkleSpeed: Math.random() * 0.03 + 0.01,
          twinklePhase: Math.random() * Math.PI * 2,
        })
      }

      const createShootingStar = () => {
        if (Math.random() < 0.005 && shootingStars.length < 3) {
          const fromLeft = Math.random() > 0.5
          shootingStars.push({
            x: fromLeft ? 0 : canvas.width,
            y: Math.random() * canvas.height * 0.6,
            vx: (fromLeft ? 1 : -1) * (Math.random() * 10 + 10),
            vy: Math.random() * 5 + 2,
            size: Math.random() * 1.5 + 1,
            alpha: 1,
            length: Math.random() * 150 + 100,
            life: 100,
          })
        }
      }

      const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const parallaxX = (mousePosition.current.x - canvas.width / 2) / 40
        const parallaxY = (mousePosition.current.y - canvas.height / 2) / 40

        particles.forEach(p => {
          p.z -= 0.4
          if (p.z <= 0) {
            p.x = Math.random() * canvas.width
            p.y = Math.random() * canvas.height
            p.z = canvas.width
          }
          const scale = canvas.width / (canvas.width + p.z)
          const x2d = p.x * scale + (canvas.width / 2) * (1 - scale) + parallaxX * scale
          const y2d = p.y * scale + (canvas.height / 2) * (1 - scale) + parallaxY * scale
          const size = p.size * scale
          p.twinklePhase += p.twinkleSpeed
          const twinkle = Math.abs(Math.sin(p.twinklePhase))
          p.alpha = Math.max(0, Math.min(1, p.alpha + 0.05 * (twinkle > 0.5 ? 1 : -1)))
          ctx.beginPath()
          ctx.arc(x2d, y2d, size, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(147, 197, 253, ${p.alpha * 0.8})`
          ctx.fill()
          p.x += p.vx
          p.y += p.vy
          if (p.x < 0 || p.x > canvas.width) p.vx *= -1
          if (p.y < 0 || p.y > canvas.height) p.vy *= -1
        })

        createShootingStar()
        shootingStars.forEach((s, index) => {
          s.x += s.vx
          s.y += s.vy
          s.life -= 1
          s.alpha = s.life / 100
          if (s.life <= 0) {
            shootingStars.splice(index, 1)
          }
          const gradient = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * (s.length / s.vx), s.y - s.vy * (s.length / s.vx))
          gradient.addColorStop(0, `rgba(255, 255, 255, ${s.alpha})`)
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(s.x - s.vx * (s.length / s.vx), s.y - s.vy * (s.length / s.vx))
          ctx.strokeStyle = gradient
          ctx.lineWidth = s.size
          ctx.stroke()
        })

        animationFrameId.current = requestAnimationFrame(animate)
      }
      animate()
    }

    window.addEventListener('resize', setupAnimation)
    setupAnimation()

    return () => {
      window.removeEventListener('resize', setupAnimation)
      window.removeEventListener('mousemove', handleMouseMove)
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [])

  return (
    <section 
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #1e293b 100%)' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full hidden md:block"
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

export default Hero
