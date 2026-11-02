'use client'

import { useCallback, useEffect, useRef, type MouseEvent, type TouchEvent } from 'react'

/** 길게 누르기로 보는 시간(ms) */
export const LONG_PRESS_MS = 450
/** 이만큼(px) 움직이면 스크롤·드래그로 보고 취소 */
export const LONG_PRESS_MOVE_TOLERANCE = 10

/** 길게 누르기를 시작하면 안 되는 대상(링크·단추·입력 등은 자기 동작이 있다) */
const INTERACTIVE = 'a,button,input,textarea,select,summary,[role="button"],[role="menuitem"]'

/** 주 입력이 hover 없는 터치 기기인가(matchMedia 없는 환경은 false) */
export function isTouchPrimary(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(hover: none)').matches
    : false
}

/**
 * 길게 누르기(터치) → onLongPress. 스크롤(10px 이상 이동)·손가락 뗌·여러 손가락이면 취소한다.
 * 발동하면 텍스트 선택을 지우고, 뒤따르는 click 은 막는다. 안드로이드의 contextmenu(길게 누르기)도
 * 터치 기기에서는 같은 동작으로 돌린다. 링크·단추 위에서는 시작하지 않는다.
 */
export function useLongPress(
  onLongPress: () => void,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const cb = useRef(onLongPress)
  useEffect(() => {
    cb.current = onLongPress
  })

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  const onTouchStart = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      cancel()
      fired.current = false
      if (!enabled || e.touches.length !== 1) return
      const target = e.target as HTMLElement
      // React 포털(작업 시트)에서 올라온 이벤트는 DOM 안이 아니므로 무시
      if (!e.currentTarget.contains(target)) return
      if (target.closest?.(INTERACTIVE)) return
      const t = e.touches[0]
      origin.current = { x: t.clientX, y: t.clientY }
      timer.current = setTimeout(() => {
        timer.current = null
        fired.current = true
        window.getSelection?.()?.removeAllRanges()
        cb.current()
      }, LONG_PRESS_MS)
    },
    [cancel, enabled]
  )

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      const o = origin.current
      const t = e.touches[0]
      if (!o || !t) return
      if (
        Math.abs(t.clientX - o.x) > LONG_PRESS_MOVE_TOLERANCE ||
        Math.abs(t.clientY - o.y) > LONG_PRESS_MOVE_TOLERANCE
      ) {
        cancel()
      }
    },
    [cancel]
  )

  const onTouchEnd = useCallback(
    (e: TouchEvent<HTMLElement>) => {
      cancel()
      // 발동한 길게 누르기 뒤의 합성 click·기본 동작을 막는다
      if (fired.current && e.cancelable) e.preventDefault()
    },
    [cancel]
  )

  const onContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (!enabled || !isTouchPrimary()) return
      if ((e.target as HTMLElement).closest?.(INTERACTIVE)) return
      e.preventDefault()
      if (!fired.current) cb.current()
    },
    [enabled]
  )

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: cancel, onContextMenu }
}
