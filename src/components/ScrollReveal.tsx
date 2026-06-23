'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 자식을 감싸 뷰포트 진입 시 1회 fade-up 한다. IntersectionObserver 기반,
 * 진입 후 unobserve로 상시 비용 제거. reduced-motion이면 즉시 표시.
 * transform/opacity만 사용(CLS=0).
 */
type ScrollRevealProps = {
  children: React.ReactNode
  delay?: number
  className?: string
}

const ScrollReveal = ({ children, delay = 0, className }: ScrollRevealProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setShown(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' }
    )
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`${shown ? 'motion-fade-up' : ''} ${className ?? ''}`}
      style={shown ? { ['--motion-delay' as string]: `${delay}ms` } : { opacity: 0 }}
    >
      {children}
    </div>
  )
}

export default ScrollReveal
