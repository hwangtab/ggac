'use client'

import Image from 'next/image'
import { useState, useEffect, memo } from 'react'
import type { OptimizedImageProps } from '@/types'

// Connection API 기반 네트워크 속도 감지
function getNetworkQuality(): { quality: number; priority: boolean } {
  if (typeof window === 'undefined') return { quality: 80, priority: false }

  const connection = (navigator as any).connection
  const effectiveType = connection?.effectiveType || '4g'

  switch (effectiveType) {
    case 'slow-2g':
    case '2g':
      return { quality: 50, priority: false }
    case '3g':
      return { quality: 65, priority: false }
    case '4g':
    default:
      return { quality: 80, priority: true }
  }
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
}: OptimizedImageProps) {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [networkQuality, setNetworkQuality] = useState({ quality: 80, priority: false })

  // 네트워크 조건 감지
  useEffect(() => {
    setNetworkQuality(getNetworkQuality())
  }, [])

  // 이미지 로딩 상태 초기화
  useEffect(() => {
    setHasError(false)
    setIsLoading(true)
    onLoadStart?.()
  }, [src, onLoadStart])

  // 최적화된 품질 계산 (네트워크 조건 반영)
  const optimizedQuality = Math.min(quality, networkQuality.quality)

  // 우선 로딩 여부 (네트워크 조건 + 명시적 priority 반영)
  const shouldPrioritize = priority && networkQuality.priority

  const handleError = () => {
    console.warn(`[OptimizedImage] 이미지 로딩 실패: ${src}`)
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
    src,
    alt: alt || '',
    quality: optimizedQuality,
    priority: shouldPrioritize,
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
    <div className={fill ? `relative ${className}` : className}>
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
