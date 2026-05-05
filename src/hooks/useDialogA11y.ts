/**
 * 모달/다이얼로그 a11y 훅
 *
 * - ESC 키로 닫기
 * - Tab 순환 (focus trap)
 * - 마운트 시 첫 포커스 가능 요소로 포커스 이동
 * - 언마운트 시 이전 포커스 위치 복원
 *
 * 사용처: 직접 모달 div 를 만드는 컴포넌트들에서 컨테이너 ref + onClose 만 넘기면
 * 표준적인 a11y 동작이 적용된다.
 */

'use client'

import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface UseDialogA11yOptions {
  /** 모달 루트 컨테이너 ref */
  containerRef: RefObject<HTMLElement | null>
  /** 모달 닫기 콜백 (ESC) */
  onClose: () => void
  /** 다이얼로그가 열려있는지 여부. false 면 모든 핸들러 비활성화. */
  isOpen?: boolean
  /** 초기 포커스를 받을 요소 ref (없으면 컨테이너 내 첫 포커스 가능 요소) */
  initialFocusRef?: RefObject<HTMLElement | null>
}

export function useDialogA11y({
  containerRef,
  onClose,
  isOpen = true,
  initialFocusRef,
}: UseDialogA11yOptions) {
  useEffect(() => {
    if (!isOpen) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const target =
      initialFocusRef?.current ||
      containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ||
      containerRef.current
    target?.focus({ preventScroll: true })

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key !== 'Tab' || !containerRef.current) return

      const focusables = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (active === first || !containerRef.current.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !containerRef.current.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus({ preventScroll: true })
    }
  }, [isOpen, onClose, containerRef, initialFocusRef])
}
