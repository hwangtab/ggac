'use client'

import { useEffect, useState } from 'react'

/**
 * 스크롤 진행도(0~1, 뷰포트 1화면 기준)를 반환하고 --scroll-y(px)를 노출한다.
 * passive + rAF 쓰로틀. disabled면 0 고정.
 */
export function useScrollParallax(options: { disabled?: boolean } = {}): number {
  const { disabled } = options
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (disabled) return
    const root = document.documentElement
    let frame = 0

    const apply = () => {
      frame = 0
      const y = window.scrollY
      root.style.setProperty('--scroll-y', `${y}px`)
      const vh = window.innerHeight || 1
      setProgress(Math.min(1, y / vh))
    }

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    apply()

    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      root.style.setProperty('--scroll-y', '0px')
    }
  }, [disabled])

  return progress
}
