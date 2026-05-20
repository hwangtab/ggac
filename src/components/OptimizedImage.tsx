'use client'

import Image from 'next/image'
import { useState, useEffect, useRef, memo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { OptimizedImageProps } from '@/types'

// Next.js 설정과 동기화된 허용 품질 값 파싱
const DEFAULT_ALLOWED_QUALITIES = [50, 65, 75, 80, 85, 90, 100]

function parseAllowedQualities(): number[] {
  const envValue = process.env.NEXT_PUBLIC_IMAGE_ALLOWED_QUALITIES
  if (!envValue) {
    return DEFAULT_ALLOWED_QUALITIES
  }

  const parsed = envValue
    .split(',')
    .map(value => parseInt(value.trim(), 10))
    .filter(value => Number.isFinite(value) && value > 0 && value <= 100)

  if (parsed.length === 0) {
    return DEFAULT_ALLOWED_QUALITIES
  }

  return Array.from(new Set(parsed)).sort((a, b) => a - b)
}

const ALLOWED_QUALITIES = parseAllowedQualities()

// 허용된 품질 값 중 계산된 값보다 작거나 같은 가장 큰 값 반환
function getValidQuality(calculatedQuality: number): number {
  return ALLOWED_QUALITIES.filter(q => q <= calculatedQuality).pop() || ALLOWED_QUALITIES[0]
}

// Connection API 기반 네트워크 속도 감지
function getNetworkQuality(): { quality: number; priority: boolean } {
  if (typeof window === 'undefined') return { quality: 80, priority: false }

  const connection = (navigator as any).connection
  const effectiveType = connection?.effectiveType || '4g'

  let rawQuality: number
  let priority: boolean

  switch (effectiveType) {
    case 'slow-2g':
    case '2g':
      rawQuality = 50
      priority = false
      break
    case '3g':
      rawQuality = 65
      priority = false
      break
    case '4g':
    default:
      rawQuality = 80
      priority = true
      break
  }

  return {
    quality: getValidQuality(rawQuality),
    priority,
  }
}

function splitUrl(url: string): { path: string; query: string } {
  if (!url) {
    return { path: '', query: '' }
  }

  const [path, ...rest] = url.split('?')

  return {
    path,
    query: rest.length ? `?${rest.join('?')}` : '',
  }
}

function appendQuery(path: string, query: string): string {
  return query ? `${path}${query}` : path
}

function buildFallbackQueue(src: string, extraSources?: string[]): string[] {
  const queue = new Set<string>()

  if (extraSources?.length) {
    extraSources.filter(Boolean).forEach(item => queue.add(item))
  }

  if (src) {
    queue.add(src)
    const { path, query } = splitUrl(src)
    const normalizedPath = path.toLowerCase()

    const addReplacements = (extension: string) => {
      queue.add(appendQuery(path.replace(/\.[^/.]+$/i, `.${extension}`), query))
    }

    if (normalizedPath.endsWith('.webp')) {
      ;['avif', 'jpg', 'jpeg', 'png'].forEach(ext => addReplacements(ext))
    } else if (normalizedPath.endsWith('.avif')) {
      ;['webp', 'jpg', 'jpeg', 'png'].forEach(ext => addReplacements(ext))
    }
  }

  queue.add('/images/default-avatar.webp')

  return Array.from(queue)
}

const OptimizedImage = memo(function OptimizedImage({
  src,
  alt,
  width,
  height,
  className = '',
  priority = false,
  fill = false,
  sizes,
  quality = 80,
  fallbackText,
  preserveAspectRatio = false,
  onLoadStart,
  onLoad: onLoadProp,
  onError: onErrorProp,
  suppressSkeleton = false,
  unoptimized = false,
  fallbackSources,
  loadTimeoutMs,
  errorTimeoutMs,
}: OptimizedImageProps) {
  const t = useTranslations('common')
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [networkQuality, setNetworkQuality] = useState({ quality: 80, priority: false })
  const [currentSrc, setCurrentSrc] = useState(src)
  const [retryCount, setRetryCount] = useState(0)
  const fallbackQueueRef = useRef<string[]>([])
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
  }, [])

  const clearLoadAndErrorTimers = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
      loadTimeoutRef.current = null
    }
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current)
      errorTimeoutRef.current = null
    }
    clearPolling()
  }, [clearPolling])

  // 네트워크 조건 감지
  useEffect(() => {
    setNetworkQuality(getNetworkQuality())
  }, [])

  // 이미지 로딩 상태 초기화
  useEffect(() => {
    fallbackQueueRef.current = buildFallbackQueue(src, fallbackSources)
    setCurrentSrc(src)
    setHasError(false)
    setIsLoading(true)
    setRetryCount(0)
    imageRef.current = null
    clearLoadAndErrorTimers()

    // 기존 타이머 정리
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
    }

    onLoadStart?.()
  }, [clearLoadAndErrorTimers, fallbackSources, onLoadStart, src])

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
      clearLoadAndErrorTimers()
    }
  }, [clearLoadAndErrorTimers])

  // 최적화된 품질 계산 (네트워크 조건 반영 + 허용된 값으로 제한)
  const optimizedQuality = getValidQuality(Math.min(quality, networkQuality.quality))

  // 우선 로딩 여부는 명시적 priority에 따르고, 네트워크 속도로 fetchPriority만 조정
  const shouldPrioritize = priority
  const fetchPriority: 'high' | 'low' | 'auto' = priority
    ? 'high'
    : networkQuality.priority
      ? 'auto'
      : 'low'

  const wrapperClass = fill
    ? className
      ? `relative ${className}`
      : 'relative'
    : className
      ? `${className} relative`
      : 'relative'

  const handleErrorRef = useRef<((event?: React.SyntheticEvent<HTMLImageElement>) => void) | null>(
    null
  )

  const handleError = useCallback(
    (event?: React.SyntheticEvent<HTMLImageElement>) => {
      clearLoadAndErrorTimers()
      const isSupabaseImage = currentSrc.includes('supabase.co')
      const maxRetries = isSupabaseImage ? 3 : 1

      // Supabase 이미지의 경우 재시도 로직 적용
      if (isSupabaseImage && retryCount < maxRetries) {
        const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000) // 지수 백오프, 최대 5초

        console.warn(
          `[OptimizedImage] Supabase 이미지 재시도 ${retryCount + 1}/${maxRetries}: ${currentSrc}`
        )

        retryTimeoutRef.current = setTimeout(() => {
          setRetryCount(prev => prev + 1)
          setIsLoading(true)
          setHasError(false)
          // 같은 URL로 재시도 (브라우저 캐시 무시를 위해 timestamp 추가)
          const cacheBuster = `retry=${Date.now()}`
          const separator = currentSrc.includes('?') ? '&' : '?'
          const retryUrl = `${currentSrc}${separator}${cacheBuster}`
          setCurrentSrc(retryUrl)
        }, retryDelay)

        return
      }

      // 재시도 실패 또는 일반 이미지의 경우 fallback으로 이동
      const nextFallback = fallbackQueueRef.current.shift()

      if (nextFallback) {
        console.warn(
          `[OptimizedImage] 이미지 로딩 실패: ${currentSrc} → 대체 시도: ${nextFallback}`
        )
        setCurrentSrc(nextFallback)
        setHasError(false)
        setIsLoading(true)
        setRetryCount(0) // 새 이미지이므로 재시도 카운트 리셋
        return
      }

      console.warn(`[OptimizedImage] 모든 이미지 로딩 실패: ${currentSrc}`)
      setHasError(true)
      setIsLoading(false)
      onErrorProp?.()
      if (event?.type === 'error') {
        const target = event.target as HTMLImageElement | undefined
        if (target) {
          target.src = '/images/default-avatar.webp'
        }
      }
    },
    [clearLoadAndErrorTimers, currentSrc, retryCount, onErrorProp]
  )

  useEffect(() => {
    handleErrorRef.current = handleError
  }, [handleError])

  useEffect(() => {
    if (!isLoading) {
      clearLoadAndErrorTimers()
      return
    }

    const isSupabaseImage = currentSrc.includes('supabase.co')
    const isLocalImage = currentSrc.startsWith('/images/') || currentSrc.startsWith('/fonts/')
    // Priority 이미지는 타임아웃 단축 (폴링으로 빠른 감지)
    const baseLoadTimeout = priority ? 2000 : isLocalImage ? 3000 : isSupabaseImage ? 12000 : 8000
    const resolvedLoadTimeout = loadTimeoutMs ?? baseLoadTimeout
    const resolvedErrorTimeout = errorTimeoutMs ?? (priority ? 2000 : 4000)

    if (resolvedLoadTimeout > 0) {
      loadTimeoutRef.current = setTimeout(() => {
        console.warn(
          `[OptimizedImage] 로딩 지연 감지(${resolvedLoadTimeout}ms) → 대체 로직 실행: ${currentSrc}`
        )
        clearLoadAndErrorTimers()
        handleErrorRef.current?.()
      }, resolvedLoadTimeout)
    }

    if (resolvedErrorTimeout > 0) {
      errorTimeoutRef.current = setTimeout(() => {
        console.warn(
          `[OptimizedImage] 최종 타임아웃(${resolvedLoadTimeout + resolvedErrorTimeout}ms) → 에러 전환: ${currentSrc}`
        )
        clearLoadAndErrorTimers()
        setHasError(prev => {
          if (!prev) {
            onErrorProp?.()
          }
          return true
        })
        setIsLoading(false)
      }, resolvedLoadTimeout + resolvedErrorTimeout)
    }

    return () => {
      clearLoadAndErrorTimers()
    }
  }, [clearLoadAndErrorTimers, currentSrc, errorTimeoutMs, isLoading, loadTimeoutMs, onErrorProp])

  const startPolling = useCallback(() => {
    clearPolling() // 기존 폴링 정리

    const pollingInterval = priority ? 50 : 200 // ms
    const maxPollingDuration = priority ? 3000 : 6000 // ms
    const startTime = Date.now()

    pollingIntervalRef.current = setInterval(() => {
      const img = imageRef.current
      const elapsedTime = Date.now() - startTime

      // 이미지가 완전히 로드되었는지 확인
      if (img && img.complete && img.naturalWidth > 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `[OptimizedImage] 🔄 폴링으로 이미지 로드 감지 (${elapsedTime}ms): ${currentSrc}`
          )
        }
        clearLoadAndErrorTimers()
        setIsLoading(false)
        onLoadProp?.()
        return
      }

      // 최대 폴링 시간 초과 시 중단
      if (elapsedTime > maxPollingDuration) {
        clearPolling()
        // 이미지 요소가 존재하고 완료 상태면 로드 처리
        if (img && img.complete) {
          clearLoadAndErrorTimers()
          setIsLoading(false)
          onLoadProp?.()
        }
      }
    }, pollingInterval)
  }, [priority, currentSrc, clearPolling, clearLoadAndErrorTimers, onLoadProp])

  const markImageLoaded = useCallback(() => {
    clearLoadAndErrorTimers()
    setIsLoading(false)

    if (process.env.NODE_ENV === 'development') {
      const isSupabaseImage = currentSrc.includes('supabase.co')
      const retryText = retryCount > 0 ? ` (${retryCount}회 재시도 후)` : ''
      console.log(`[OptimizedImage] ✅ 이미지 로드 성공${retryText}: ${currentSrc}`)

      if (isSupabaseImage) {
        console.log(
          `[OptimizedImage] 📊 Supabase 이미지 로딩 통계 - 성공 (재시도: ${retryCount}회)`
        )
      }
    }

    onLoadProp?.()
  }, [clearLoadAndErrorTimers, currentSrc, retryCount, onLoadProp])

  const handleLoad = useCallback(() => {
    markImageLoaded()
  }, [markImageLoaded])

  useEffect(() => {
    const img = imageRef.current
    if (img && img.complete && img.naturalWidth > 0) {
      markImageLoaded()
      return
    }
    // 이미지가 아직 로드되지 않은 경우 폴링으로 보조 감지
    if (isLoading) {
      startPolling()
    }
  }, [currentSrc, markImageLoaded, isLoading, startPolling])

  // 절대 안전 타임아웃: 15초 후에도 로딩 중이면 강제 해제
  useEffect(() => {
    if (!isLoading) return
    const safetyTimeout = setTimeout(() => {
      setIsLoading(false)
    }, 15000)
    return () => clearTimeout(safetyTimeout)
  }, [isLoading, currentSrc])

  // 재시도 핸들러
  const handleRetry = () => {
    setHasError(false)
    setIsLoading(true)
    setRetryCount(0)
    fallbackQueueRef.current = buildFallbackQueue(src, fallbackSources)
    setCurrentSrc(src) // 원본 이미지로 다시 시도
    clearLoadAndErrorTimers()
  }

  // 에러 상태 - fallback UI
  if (hasError) {
    return (
      <div
        className={`bg-gradient-to-br from-primary-100 to-accent-100 flex flex-col items-center justify-center gap-2 ${className}`}
        style={{ width: fill ? '100%' : width, height: fill ? '100%' : height }}
      >
        <span className="text-primary-600 font-medium text-center px-4 text-xl font-sans">
          {fallbackText || alt.slice(0, 3)}
        </span>
        {src?.includes('supabase.co') && (
          <button
            onClick={handleRetry}
            className="text-xs text-primary-500 hover:text-primary-700 underline transition-colors"
            title={t('image.reload')}
          >
            {t('image.retry')}
          </button>
        )}
      </div>
    )
  }

  // 모바일 우선 sizes 최적화
  const optimizedSizes =
    sizes ||
    (fill
      ? '(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw'
      : `(max-width: 640px) 50vw, (max-width: 768px) ${Math.min(width || 400, 400)}px, ${width || 800}px`)

  const imageProps = {
    src: currentSrc,
    quality: optimizedQuality,
    priority: shouldPrioritize,
    fetchPriority,
    onError: handleError,
    onLoad: handleLoad,
    className,
    unoptimized,
    placeholder: 'blur' as const,
    blurDataURL:
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyJckliyjqTzSlT54b6bk+h0R//2Q==',
    sizes: optimizedSizes,
    ...(fill
      ? { fill: true }
      : {
          width: width || 800,
          height: height || 600,
        }),
  }

  // 동적으로 rounded 클래스 감지
  const getRoundedClass = (className?: string): string => {
    if (!className) return ''

    // rounded-full 클래스가 있는지 확인
    if (className.includes('rounded-full')) return 'rounded-full'

    // 다른 rounded 클래스들 확인 (간단한 패턴 매칭)
    const roundedClasses = className.split(' ').filter(cls => cls.startsWith('rounded-'))
    return roundedClasses.join(' ')
  }

  const skeletonRoundedClass = getRoundedClass(className)

  // 렌더링
  return (
    <div className={wrapperClass}>
      {/* 로딩 스켈레톤 (외부 스켈레톤이 없을 때만) */}
      {isLoading && !suppressSkeleton && !priority && (
        <div
          className={`absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse ${skeletonRoundedClass}`}
        >
          {/* 스피너는 별도 레이어에서 중앙 배치 - rounded 클리핑 회피 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
          </div>
        </div>
      )}

      <Image
        alt={alt || ''}
        {...imageProps}
        ref={(el: HTMLImageElement | null) => {
          imageRef.current = el
          if (el && el.complete && el.naturalWidth > 0) {
            markImageLoaded()
          }
        }}
        className={`transition-opacity duration-500 ${
          suppressSkeleton || priority ? '' : isLoading ? 'opacity-0' : 'opacity-100'
        } ${fill ? '' : className}`}
      />
    </div>
  )
})

export default OptimizedImage
