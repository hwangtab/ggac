'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

const Hero = () => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // 파티클 효과 구현
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const particles: Array<{
      x: number
      y: number
      vx: number
      vy: number
      size: number
      alpha: number
    }> = []

    // 파티클 생성
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 2 + 1,
        alpha: Math.random() * 0.5 + 0.2
      })
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      particles.forEach(particle => {
        particle.x += particle.vx
        particle.y += particle.vy

        if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1
        if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1

        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(14, 165, 233, ${particle.alpha})`
        ctx.fill()
      })

      requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [])

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)' }}
      />

      {/* Video Background (placeholder) */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-900/50 to-accent-900/50 mix-blend-multiply" />

      {/* Content */}
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

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-white animate-bounce">
        <div className="w-6 h-10 border-2 border-white rounded-full flex justify-center">
          <div className="w-1 h-3 bg-white rounded-full mt-2 animate-pulse" />
        </div>
      </div>
    </section>
  )
}

export default Hero
