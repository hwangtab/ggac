import { useEffect } from 'react'

/**
 * 포인터 위치를 정규화(-1~1)해 CSS 변수 --mx/--my로 노출한다.
 * transform만 갱신하므로 레이아웃/페인트 비용 없음. rAF 쓰로틀.
 * disabled(터치/모바일/reduced-motion)면 아무 것도 하지 않는다.
 */
export function usePointerParallax(
  ref: React.RefObject<HTMLElement | null>,
  options: { disabled?: boolean } = {}
): void {
  const { disabled } = options

  useEffect(() => {
    if (disabled) return
    const el = ref.current
    if (!el) return

    const root = document.documentElement
    let frame = 0
    let nextX = 0
    let nextY = 0

    const apply = () => {
      frame = 0
      root.style.setProperty('--mx', String(nextX))
      root.style.setProperty('--my', String(nextY))
    }

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      nextX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      nextY = ((e.clientY - rect.top) / rect.height) * 2 - 1
      if (!frame) frame = requestAnimationFrame(apply)
    }

    el.addEventListener('pointermove', onMove, { passive: true })

    return () => {
      el.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
      root.style.setProperty('--mx', '0')
      root.style.setProperty('--my', '0')
    }
  }, [ref, disabled])
}
