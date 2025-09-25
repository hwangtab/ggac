'use client'

import Image from 'next/image'
import { useState, useEffect, useRef, memo } from 'react'
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

function buildFallbackQueue(src: string, extraSources?: string[]): string[] {
  const queue = new Set<string>()

  if (extraSources?.length) {
    extraSources.filter(Boolean).forEach(item => queue.add(item))
  }

  if (src) {
    if (src.endsWith('.webp')) {
      queue.add(src.replace(/\.webp$/i, '.avif'))
      queue.add(src.replace(/\.webp$/i, '.jpg'))
      queue.add(src.replace(/\.webp$/i, '.jpeg'))
      queue.add(src.replace(/\.webp$/i, '.png'))
    } else if (src.endsWith('.avif')) {
      queue.add(src.replace(/\.avif$/i, '.webp'))
      queue.add(src.replace(/\.avif$/i, '.jpg'))
      queue.add(src.replace(/\.avif$/i, '.jpeg'))
      queue.add(src.replace(/\.avif$/i, '.png'))
    }
  }

  queue.add('/images/default-avatar.webp')

  queue.delete(src)

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
}: OptimizedImageProps) {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [networkQuality, setNetworkQuality] = useState({ quality: 80, priority: false })
  const [currentSrc, setCurrentSrc] = useState(src)
  const fallbackQueueRef = useRef<string[]>([])

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
    onLoadStart?.()
  }, [src, fallbackSources, onLoadStart])

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

  const handleError = () => {
    const nextFallback = fallbackQueueRef.current.shift()

    if (nextFallback) {
      console.warn(`[OptimizedImage] 이미지 로딩 실패: ${currentSrc} → 대체 시도: ${nextFallback}`)
      setCurrentSrc(nextFallback)
      setHasError(false)
      setIsLoading(true)
      return
    }

    console.warn(`[OptimizedImage] 이미지 로딩 실패: ${currentSrc}`)
    setHasError(true)
    setIsLoading(false)
    onErrorProp?.()
  }

  const handleLoad = () => {
    setIsLoading(false)
    onLoadProp?.()
  }

  // 에러 상태 - fallback UI
  if (hasError) {
    return (
      <div
        className={`bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center ${className}`}
        style={{ width: fill ? '100%' : width, height: fill ? '100%' : height }}
      >
        <span className="text-primary-600 font-medium text-center px-4 text-2xl font-sans">
          {fallbackText || alt.slice(0, 3)}
        </span>
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
    alt: alt || '',
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

  // 렌더링
  return (
    <div className={wrapperClass}>
      {/* 로딩 스켈레톤 (외부 스켈레톤이 없을 때만) */}
      {isLoading && !suppressSkeleton && (
        <div
          className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse flex items-center justify-center"
          style={{ width: fill ? '100%' : width, height: fill ? '100%' : height }}
        >
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
        </div>
      )}

      <Image
        {...imageProps}
        className={`transition-opacity duration-500 ${
          suppressSkeleton ? '' : isLoading ? 'opacity-0' : 'opacity-100'
        } ${fill ? '' : className}`}
      />
    </div>
  )
})

export default OptimizedImage
