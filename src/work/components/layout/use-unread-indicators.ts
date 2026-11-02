'use client'

import { useEffect } from 'react'
import { APP_NAME } from '@work/lib/brand'
import { stripCountPrefix, titleWithCount } from './nav-sections'

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/**
 * 안 읽음 수 N 을 탭 제목 접두사 `(N) `과 PWA 앱 아이콘 배지로 알린다(설계 03 §2-6).
 * - 제목: 페이지가 정한 제목(Next 메타데이터)은 그대로 두고 앞에 `(N) `만 붙인다. 기본 제목은
 *   `(N) 한국스마트협동조합 업무 시스템`. 이동할 때 Next 가 제목을 다시 쓰므로 <title> 변경을 지켜보다 다시 붙인다.
 * - 배지: navigator.setAppBadge / clearAppBadge — 지원하지 않는 브라우저는 무시한다.
 * N 은 SidebarLiveUpdates 의 router.refresh() 로 레이아웃이 다시 계산되면 따라 바뀐다(추가 조회 없음).
 */
export function useUnreadIndicators(count: number): void {
  useEffect(() => {
    const apply = () => {
      const base = stripCountPrefix(document.title) || APP_NAME
      const next = titleWithCount(base, count)
      if (document.title !== next) document.title = next
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      document.title = stripCountPrefix(document.title)
    }
  }, [count])

  useEffect(() => {
    const nav = navigator as BadgeNavigator
    try {
      const pending = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.()
      // 권한·플랫폼 사유의 거부는 조용히 넘긴다
      pending?.catch(() => undefined)
    } catch {
      // 지원하지 않거나 동기 예외 — 무시
    }
  }, [count])
}
