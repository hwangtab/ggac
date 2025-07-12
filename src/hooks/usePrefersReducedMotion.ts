'use client'

import { useEffect, useState } from 'react'

/**
 * 사용자의 접근성 설정에서 '동작 줄이기'를 확인하는 훅
 * 
 * @returns {boolean} prefers-reduced-motion이 활성화되어 있으면 true
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    // 서버사이드 렌더링에서는 false로 시작
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    
    // 초기값 설정
    setPrefersReducedMotion(mediaQuery.matches)
    
    // 미디어 쿼리 변경 감지
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }
    
    // 이벤트 리스너 등록
    mediaQuery.addEventListener('change', handleChange)
    
    // 클린업
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  return prefersReducedMotion
}