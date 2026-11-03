'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { autoTooltipText, findTooltipTarget, placeTooltip } from '@work/lib/ui/auto-tooltip'

const SHOW_DELAY_MS = 400

type Shown = { el: Element; text: string }

/**
 * 앱 전체 공통 툴팁(루트 레이아웃에 하나). 아이콘만 있는 버튼·링크에 마우스를 올리거나(마우스·펜)
 * 키보드로 포커스하면 aria-label 을 작은 말풍선으로 보여 준다. 판정 규칙은 `src/lib/ui/auto-tooltip.ts`.
 * 버튼마다 Tooltip 을 감싸지 않아도 되고, 새로 만드는 아이콘 버튼도 aria-label 만 있으면 자동으로 붙는다.
 * 터치(길게 누르기 메뉴와 겹침)에는 띄우지 않는다. 말풍선은 aria-hidden — 이름은 이미 aria-label 로 읽힌다.
 */
export default function AutoTooltip() {
  const [shown, setShown] = useState<Shown | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  // 이벤트 처리기에서 현재 대상 비교용(상태를 의존성에 넣지 않으려고)
  const shownEl = useRef<Element | null>(null)
  shownEl.current = shown?.el ?? null

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearTimer()
    setShown(null)
    setPos(null)
  }, [clearTimer])

  const showLater = useCallback(
    (el: Element, delay: number) => {
      clearTimer()
      timer.current = window.setTimeout(() => {
        timer.current = null
        if (!el.isConnected) return
        const text = autoTooltipText(el)
        if (text) setShown({ el, text })
      }, delay)
    },
    [clearTimer]
  )

  useEffect(() => {
    function onPointerOver(e: PointerEvent) {
      if (e.pointerType === 'touch') return
      const el = findTooltipTarget(e.target)
      if (!el) return
      if (shownEl.current === el) return
      hide()
      showLater(el, SHOW_DELAY_MS)
    }
    function onPointerOut(e: PointerEvent) {
      const to = e.relatedTarget as Node | null
      const el = findTooltipTarget(e.target)
      if (el && to && el.contains(to)) return
      hide()
    }
    function onFocusIn(e: FocusEvent) {
      const target = e.target as Element | null
      // 키보드 포커스만(마우스 클릭으로 생긴 포커스는 제외)
      if (!target || !safeMatches(target, ':focus-visible')) return
      const el = findTooltipTarget(target)
      if (!el) return
      hide()
      showLater(el, 0)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('pointerover', onPointerOver)
    document.addEventListener('pointerout', onPointerOut)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      clearTimer()
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [hide, showLater, clearTimer])

  useLayoutEffect(() => {
    if (!shown || !tipRef.current) return
    const a = shown.el.getBoundingClientRect()
    const t = tipRef.current.getBoundingClientRect()
    const p = placeTooltip(
      { top: a.top, bottom: a.bottom, left: a.left, width: a.width },
      { width: t.width, height: t.height },
      { width: window.innerWidth, height: window.innerHeight }
    )
    setPos({ x: p.x, y: p.y })
  }, [shown])

  if (!shown) return null
  return (
    <div
      ref={tipRef}
      aria-hidden="true"
      data-slot="auto-tooltip"
      className="pointer-events-none fixed top-0 left-0 z-[200] max-w-xs rounded-w-lg border border-border bg-popover px-2 py-1 text-xs text-foreground"
      style={{
        transform: pos ? `translate(${pos.x}px, ${pos.y}px)` : undefined,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {shown.text}
    </div>
  )
}

function safeMatches(el: Element, selector: string): boolean {
  if (typeof el.matches !== 'function') return false
  try {
    return el.matches(selector)
  } catch {
    // :focus-visible 을 모르는 환경(jsdom 등)에서는 포커스면 띄운다
    return true
  }
}
