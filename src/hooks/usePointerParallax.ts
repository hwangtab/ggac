'use client'

import { useEffect } from 'react'

/**
 * 포인터 위치를 정규화(-1~1)해 CSS 변수 --mx/--my로 노출한다.
 * transform만 갱신하므로 레이아웃/페인트 비용 없음. rAF 쓰로틀.
 * disabled(터치/모바일/reduced-motion)면 아무 것도 하지 않는다.
 *
 * 변수는 **대상 요소에만** 쓴다. documentElement에 쓰면 상속형 커스텀 프로퍼티라
 * Blink가 문서 전체 스타일을 무효화한다 — 이 변수를 읽는 요소가 단 하나뿐이어도
 * 그렇다. 노드 687개짜리 홈에서 실측한 1회 비용은 요소 직접 쓰기 0.014ms 대
 * documentElement 2.95ms로 약 215배 차이였고, 60fps에서 초당 177ms를 태운다.
 * 값은 상속되므로 후손(.hero-spotlight)은 그대로 읽는다.
 *
 * 성능 최적화: getBoundingClientRect를 매 pointermove마다 호출하지 않고
 * rect를 캐시한다. resize/scroll(passive) 이벤트에서만 rect를 갱신해
 * 강제 레이아웃 읽기(layout thrashing)를 최소화한다.
 */
export function usePointerParallax(
  ref: React.RefObject<HTMLElement | null>,
  options: { disabled?: boolean } = {}
): void {
  const { disabled } = options

  useEffect(() => {
    if (disabled) return
    // 터치 기기(coarse pointer)에서는 포인터 시차 비활성 — pointermove가 발화돼도 무시
    if (window.matchMedia('(pointer: coarse)').matches) return
    const el = ref.current
    if (!el) return

    let frame = 0
    let nextX = 0
    let nextY = 0

    // rect 캐시 — 매 pointermove 마다 getBoundingClientRect 호출을 피한다
    let cachedRect = el.getBoundingClientRect()

    // resize/scroll 시 rect 갱신 (passive: 스크롤 성능 보존)
    const updateRect = () => {
      cachedRect = el.getBoundingClientRect()
    }

    window.addEventListener('resize', updateRect, { passive: true })
    window.addEventListener('scroll', updateRect, { passive: true })

    const apply = () => {
      frame = 0
      el.style.setProperty('--mx', String(nextX))
      el.style.setProperty('--my', String(nextY))
    }

    const onMove = (e: PointerEvent) => {
      // 캐시된 rect 사용 — 강제 레이아웃 읽기 없음
      nextX = ((e.clientX - cachedRect.left) / cachedRect.width) * 2 - 1
      nextY = ((e.clientY - cachedRect.top) / cachedRect.height) * 2 - 1
      if (!frame) frame = requestAnimationFrame(apply)
    }

    el.addEventListener('pointermove', onMove, { passive: true })

    return () => {
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect)
      if (frame) cancelAnimationFrame(frame)
      el.style.removeProperty('--mx')
      el.style.removeProperty('--my')
    }
  }, [ref, disabled])
}
