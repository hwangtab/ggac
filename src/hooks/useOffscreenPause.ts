'use client'

import { useEffect } from 'react'

/**
 * 요소가 뷰포트를 벗어나면 `data-offscreen="true"`를 달아 장식 애니메이션을 멈춘다.
 *
 * CSS 애니메이션은 화면 밖으로 나가도 스스로 멈추지 않는다. `contain`도 이를 막지
 * 못한다. 히어로를 지나쳐 한참 스크롤한 뒤에도 워시 2개·그레인 2개·마퀴 2개가 계속
 * 틱하며 GPU 합성과 스타일 재계산(초당 60회)을 유발한다. 실제 정지는
 * globals.css의 `[data-offscreen='true']` 규칙이 담당한다.
 *
 * IntersectionObserver가 없는 환경에서는 아무것도 하지 않는다(= 기존 동작 유지).
 */
export function useOffscreenPause(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.removeAttribute('data-offscreen')
          } else {
            el.setAttribute('data-offscreen', 'true')
          }
        }
      },
      // 완전히 벗어난 뒤에만 멈춘다. 경계에서 깜빡이지 않도록 여유를 둔다.
      { rootMargin: '120px', threshold: 0 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
}
