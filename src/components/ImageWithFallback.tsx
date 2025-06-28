'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

interface ImageWithFallbackProps {
  src: string
  alt: string
  width: number
  height: number
  className?: string
  fallbackText?: string
  preferWebp?: boolean // WEBP 우선 사용 여부
  preserveAspectRatio?: boolean // 원본 비율 유지 여부
}

const ImageWithFallback = ({
  src,
  alt,
  width,
  height,
  className = '',
  fallbackText,
  preferWebp = true,
  preserveAspectRatio = false
}: ImageWithFallbackProps) => {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isMounted, setIsMounted] = useState(false)
  const [currentSrc, setCurrentSrc] = useState(src)
  const [hasTriedWebp, setHasTriedWebp] = useState(false)
  const [hasTriedDynamicWebp, setHasTriedDynamicWebp] = useState(false)

  // 이미지 소스 최적화 함수
  const getOptimizedSrc = (originalSrc: string): string => {
    if (!preferWebp || !originalSrc.startsWith('/')) {
      return originalSrc
    }

    // JPG/JPEG/PNG를 WEBP로 변환 시도
    if (originalSrc.match(/\.(jpe?g|png)$/i)) {
      // 우선 동일한 이름의 WEBP 파일이 있는지 시도
      return originalSrc.replace(/\.(jpe?g|png)$/i, '.webp')
    }

    return originalSrc
  }

  // 동적 변환 API를 사용하는 함수 (JPG만 있을 때)
  const getDynamicWebpSrc = (originalSrc: string): string => {
    if (!preferWebp || !originalSrc.startsWith('/')) {
      return originalSrc
    }

    if (originalSrc.match(/\.(jpe?g|png)$/i)) {
      return `/api/images?path=${encodeURIComponent(originalSrc)}&format=webp`
    }

    return originalSrc
  }

  useEffect(() => {
    setIsMounted(true)
    // 처음 로드할 때 WEBP 버전 시도
    if (preferWebp && src.startsWith('/') && src.match(/\.(jpe?g|png)$/i)) {
      const webpSrc = getOptimizedSrc(src)
      setCurrentSrc(webpSrc)
    }
  }, [src, preferWebp])

  const handleLoad = () => {
    const isWebpOptimized = currentSrc !== src && currentSrc.endsWith('.webp')
    console.log(`Image loaded successfully: ${currentSrc}${isWebpOptimized ? ' (WEBP optimized)' : ''}`)
    setIsLoading(false)
    setHasError(false)
  }

  const handleError = () => {
    console.log('Image failed to load:', currentSrc)
    
    // 1. 정적 WEBP 파일 시도 실패 시 동적 변환 시도
    if (!hasTriedDynamicWebp && currentSrc !== src && preferWebp && currentSrc.endsWith('.webp')) {
      const dynamicWebpSrc = getDynamicWebpSrc(src)
      if (dynamicWebpSrc !== src) {
        console.log('Static WEBP failed, trying dynamic conversion:', dynamicWebpSrc)
        setHasTriedDynamicWebp(true)
        setCurrentSrc(dynamicWebpSrc)
        setHasError(false)
        setIsLoading(true)
        return
      }
    }
    
    // 2. 동적 WEBP 실패 시 원본 JPG/PNG로 폴백
    if ((hasTriedWebp || hasTriedDynamicWebp) && currentSrc !== src) {
      console.log('WEBP conversions failed, falling back to original:', src)
      setHasTriedWebp(true)
      setCurrentSrc(src)
      setHasError(false)
      setIsLoading(true)
      return
    }
    
    // 3. 원본도 실패하면 fallback UI 표시
    setHasError(true)
    setIsLoading(false)
  }

  if (hasError) {
    return (
      <div className={`w-full ${preserveAspectRatio ? 'min-h-[200px]' : 'h-full'} bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center`}>
        <span className="text-primary-600 font-medium text-center px-4 text-2xl font-serif">
          {fallbackText || alt.slice(0, 3)}
        </span>
      </div>
    )
  }

  return (
    <div className={`w-full ${preserveAspectRatio ? 'h-auto' : 'h-full'} relative ${className}`}>
      {(isLoading && isMounted) && (
        <div className={`absolute inset-0 bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center ${preserveAspectRatio ? 'min-h-[200px]' : ''}`}>
          <span className="text-primary-600 font-medium text-center px-4 text-2xl font-serif">
            {fallbackText || alt.slice(0, 3)}
          </span>
        </div>
      )}
      <Image
        src={currentSrc}
        alt={alt}
        width={width}
        height={height}
        className={`w-full ${preserveAspectRatio ? 'h-auto' : 'h-full object-cover'} ${isMounted && isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
        onLoad={handleLoad}
        onError={handleError}
        key={currentSrc} // 소스 변경 시 컴포넌트 리렌더링 강제
      />
    </div>
  )
}

export default ImageWithFallback
