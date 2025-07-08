'use client'

import Image from 'next/image'
import { useState, useEffect, useCallback, memo } from 'react'

interface OptimizedImageProps {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
  priority?: boolean
  fill?: boolean
  sizes?: string
  quality?: number
  fallbackText?: string
  preferWebp?: boolean // WEBP 우선 사용 여부
  preserveAspectRatio?: boolean // 원본 비율 유지 여부
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
  quality = 85,
  fallbackText,
  preferWebp = true,
  preserveAspectRatio = false
}: OptimizedImageProps) {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [currentSrc, setCurrentSrc] = useState(src)
  const [hasTriedWebp, setHasTriedWebp] = useState(false)

  // WebP 최적화 함수
  const getOptimizedSrc = useCallback((originalSrc: string): string => {
    if (!preferWebp || !originalSrc.startsWith('/')) {
      return originalSrc
    }

    // JPG/JPEG/PNG를 WEBP로 변환 시도
    if (originalSrc.match(/\.(jpe?g|png)$/i)) {
      return originalSrc.replace(/\.(jpe?g|png)$/i, '.webp')
    }

    return originalSrc
  }, [preferWebp])

  // WebP 로드 시도
  useEffect(() => {
    if (preferWebp && src.startsWith('/') && src.match(/\.(jpe?g|png)$/i)) {
      const webpSrc = getOptimizedSrc(src)
      setCurrentSrc(webpSrc)
    }
  }, [src, preferWebp, getOptimizedSrc])

  const handleError = () => {
    if (!hasTriedWebp && currentSrc !== src) {
      // WebP 실패시 원본으로 fallback
      setHasTriedWebp(true)
      setCurrentSrc(src)
      console.log(`WebP failed, fallback to original: ${src}`)
    } else {
      setHasError(true)
    }
  }

  const handleLoad = () => {
    setIsLoading(false)
    const isWebpOptimized = currentSrc !== src && currentSrc.endsWith('.webp')
    console.log(`Image loaded: ${currentSrc}${isWebpOptimized ? ' (WebP optimized)' : ''}`)
  }

  if (hasError) {
    return (
      <div className={`bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center ${className}`}>
        <span className="text-primary-600 font-medium text-center px-4 text-2xl font-sans">
          {fallbackText || alt.slice(0, 3)}
        </span>
      </div>
    )
  }

  const imageProps = {
    src: currentSrc,
    alt,
    quality,
    priority,
    onError: handleError,
    onLoad: handleLoad,
    className,
    // Next.js가 자동으로 WebP/AVIF 변환하므로 placeholder는 기본값 사용
    placeholder: 'blur' as const,
    blurDataURL: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABIAAgACgAKAAoADhCSVqcGzAAAAAElFTkSuQmCC',
    ...(fill 
      ? { 
          fill: true, 
          sizes: sizes || '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
        }
      : { 
          width: width || 800, 
          height: height || 600,
          sizes: sizes || '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
        }
    )
  }

  // Progressive loading with loading indicator
  return (
    <div className={`relative ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
        </div>
      )}
      <Image 
        {...imageProps} 
        alt={alt || ''} 
        className={`transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'} ${className}`}
      />
    </div>
  )
})

export default OptimizedImage
