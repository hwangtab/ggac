'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * 자식을 감싸 뷰포트 진입 시 1회 fade-up 한다. IntersectionObserver 기반,
 * 진입 후 unobserve로 상시 비용 제거. reduced-motion이면 즉시 표시.
 * transform/opacity만 사용(CLS=0).
 *
 * Progressive enhancement 전략:
 * - 기본 상태(SSR·하이드레이션 전·JS 비활성)는 콘텐츠가 보이는 상태(visible).
 *   크롤러/no-JS 사용자가 콘텐츠를 볼 수 있도록 보장.
 * - JS 마운트 후 useLayoutEffect(브라우저 페인트 전)에서 동기적으로 'hidden'으로
 *   전환해 flash(보임→숨김 깜빡임) 없이 fade-up 애니메이션을 준비한다.
 * - 뷰포트에 이미 진입된 요소는 IntersectionObserver 초기 콜백에서 즉시 reveal.
 */

// SSR 안전 isomorphic layout effect — 서버에서는 useEffect로 폴백
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

type ScrollRevealProps = {
  children: React.ReactNode
  delay?: number
  className?: string
}

// 상태: 'visible'(기본·no-JS) | 'hidden'(JS 마운트 후 애니 준비) | 'revealed'(뷰포트 진입)
type RevealState = 'visible' | 'hidden' | 'revealed'

const ScrollReveal = ({ children, delay = 0, className }: ScrollRevealProps) => {
  const ref = useRef<HTMLDivElement>(null)
  // 기본 'visible' — SSR·크롤러·no-JS 사용자가 콘텐츠를 볼 수 있도록
  const [state, setState] = useState<RevealState>('visible')

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    // reduced-motion: 항상 보임 유지 (애니메이션 생략)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setState('visible')
      return
    }

    // 브라우저 페인트 전 동기적으로 숨김 → flash 없이 fade-up 준비
    setState('hidden')

    // rootMargin 제거: threshold만 사용해 짧은 뷰포트에서도 안정적으로 reveal
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setState('revealed')
          observer.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  const isHidden = state === 'hidden'
  const isRevealed = state === 'revealed'

  return (
    <div
      ref={ref}
      className={`${isRevealed ? 'motion-fade-up' : ''} ${className ?? ''}`}
      style={
        isRevealed
          ? { ['--motion-delay' as string]: `${delay}ms` }
          : isHidden
            ? { opacity: 0 }
            : undefined
      }
    >
      {children}
    </div>
  )
}

export default ScrollReveal
