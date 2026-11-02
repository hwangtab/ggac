'use client'

import { useEffect } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { mainSections, sectionForShortcut } from './nav-sections'
import { resolveSectionHref } from './use-last-location'
import type { ChannelListItem } from './channel-items'

/** 입력창·텍스트 필드에 포커스가 있으면 Alt+숫자를 가로채지 않는다 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.getAttribute('role') === 'textbox') return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Alt+1 … Alt+7 → 레일 항목 1~7(활동·채팅·채널·할 일·결재·자료실·위키; 게스트는 보이는 항목까지만). 설계 03 §2-7.
 * 맥에서 Option+숫자는 특수문자가 나오므로 `e.key` 가 아니라 물리 키 `e.code === 'Digit1'` 로 판정한다.
 * ⌘/Ctrl+숫자는 브라우저 탭 전환과 겹쳐 쓰지 않는다. 레일 클릭과 같은 "마지막 위치" 규칙으로 이동한다.
 */
export function useSectionShortcuts({
  isGuest,
  items,
}: {
  isGuest: boolean
  items: Pick<ChannelListItem, 'id' | 'slug' | 'kind'>[]
}): void {
  const router = useRouter()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      // 한글 IME 조합 중이거나 다른 핸들러(다이얼로그 등)가 이미 처리한 키는 건드리지 않는다
      if (e.defaultPrevented || e.isComposing) return
      if (isTypingTarget(e.target)) return
      const section = sectionForShortcut(e.code, mainSections({ isGuest }))
      if (!section) return
      e.preventDefault()
      router.push(resolveSectionHref(section, items))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isGuest, items, router])
}
