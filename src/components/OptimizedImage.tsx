'use client'

import Image from 'next/image'
import { useState, useEffect, memo } from 'react'
import type { OptimizedImageProps } from '@/types'

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

  // 이미지 상태 초기화
  useEffect(() => {
    // Next.js Image 컴포넌트의 자동 최적화에 의존
    setHasError(false)
    setIsLoading(true)
  }, [src])

  const handleError = () => {
    setHasError(true)
    console.log(`Image failed to load: ${src}`)
  }

  const handleLoad = () => {
    setIsLoading(false)
    console.log(`Image loaded: ${src}`)
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
    src,
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
