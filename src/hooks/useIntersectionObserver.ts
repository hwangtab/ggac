'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createLogger } from '@/utils/logger'

const log = createLogger('useIntersectionObserver')

interface UseIntersectionObserverOptions extends IntersectionObserverInit {
  // 한번 교차한 후 계속 추적할지 여부
  triggerOnce?: boolean
  // 교차 전에 미리 로딩을 시작할 여백
  preloadMargin?: string
}

interface UseIntersectionObserverReturn {
  // 관찰할 요소에 연결할 ref
  targetRef: React.RefObject<HTMLDivElement | null>
  // 현재 뷰포트와 교차 중인지
  isIntersecting: boolean
  // 한번이라도 교차했는지 (triggerOnce용)
  hasIntersected: boolean
  // 교차 비율 (0-1)
  intersectionRatio: number
  // 수동으로 교차 상태 초기화
  reset: () => void
}

/**
 * 뷰포트 교차 감지를 위한 최적화된 훅
 * 코드 분할 및 지연 로딩에 특화
 */
export const useIntersectionObserver = (
  options: UseIntersectionObserverOptions = {}
): UseIntersectionObserverReturn => {
  const {
    threshold = 0.1,
    rootMargin = '100px',
    preloadMargin = '200px',
    triggerOnce = true,
    ...observerOptions
  } = options

  const [isIntersecting, setIsIntersecting] = useState(false)
  const [hasIntersected, setHasIntersected] = useState(false)
  const [intersectionRatio, setIntersectionRatio] = useState(0)

  const targetRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // 상태 초기화 함수
  const reset = useCallback(() => {
    setIsIntersecting(false)
    setHasIntersected(false)
    setIntersectionRatio(0)
  }, [])

  // 교차 상태 변경 핸들러
  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries

      setIsIntersecting(entry.isIntersecting)
      setIntersectionRatio(entry.intersectionRatio)

      // triggerOnce가 true면 한번 교차 후 더 이상 추적하지 않음
      if (entry.isIntersecting && !hasIntersected) {
        setHasIntersected(true)

        if (triggerOnce && observerRef.current) {
          observerRef.current.disconnect()
        }
      }
    },
    [hasIntersected, triggerOnce]
  )

  // observer 옵션 중 의미 있는 변화만 감지하기 위한 직렬화 키
  const observerOptionsKey = useMemo(() => JSON.stringify(observerOptions ?? {}), [observerOptions])

  // IntersectionObserver 설정 및 정리
  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    // 이미 한번 교차했고 triggerOnce가 true면 새로운 observer 생성하지 않음
    if (hasIntersected && triggerOnce) return

    try {
      observerRef.current = new IntersectionObserver(handleIntersection, {
        threshold,
        rootMargin: hasIntersected ? rootMargin : preloadMargin,
        ...observerOptions,
      })

      observerRef.current.observe(target)
    } catch (error) {
      log.error('IntersectionObserver 생성 실패', error)
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
    // observerOptionsKey 사용으로 객체 참조 변경 시 불필요한 재구독을 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    handleIntersection,
    threshold,
    rootMargin,
    preloadMargin,
    hasIntersected,
    triggerOnce,
    observerOptionsKey,
  ])

  return {
    targetRef,
    isIntersecting,
    hasIntersected,
    intersectionRatio,
    reset,
  }
}

/**
 * 지연 로딩 전용 간소화된 훅
 * 한번 로딩되면 다시는 언로드하지 않는 용도
 */
export const useLazyLoading = (
  options: Omit<UseIntersectionObserverOptions, 'triggerOnce'> = {}
) => {
  const { hasIntersected, targetRef } = useIntersectionObserver({
    ...options,
    triggerOnce: true,
  })

  return {
    shouldLoad: hasIntersected,
    targetRef,
  }
}

/**
 * 성능 최적화된 뷰포트 감지 훅
 * 컴포넌트가 실제로 보여질 때만 리소스 로딩
 */
export const useViewportEntry = (options: UseIntersectionObserverOptions = {}) => {
  const { isIntersecting, hasIntersected, intersectionRatio, targetRef } = useIntersectionObserver({
    threshold: [0, 0.25, 0.5, 0.75, 1],
    rootMargin: '50px',
    triggerOnce: false,
    ...options,
  })

  // 컴포넌트 가시성 상태 계산
  const visibilityState =
    intersectionRatio === 0
      ? 'hidden'
      : intersectionRatio < 0.5
        ? 'partial'
        : intersectionRatio === 1
          ? 'full'
          : 'mostly'

  return {
    targetRef,
    isVisible: isIntersecting,
    hasBeenVisible: hasIntersected,
    visibilityRatio: intersectionRatio,
    visibilityState,
  }
}
