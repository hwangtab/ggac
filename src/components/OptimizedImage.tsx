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
  quality = 75, // Next.js config의 기본값과 일치
  fallbackText,
  // preferWebp 제거: Next.js가 자동으로 AVIF/WebP 선택
  preserveAspectRatio = false
}: OptimizedImageProps) {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [currentSrc, setCurrentSrc] = useState(src)

  // 이미지 상태 초기화 - Next.js가 모든 최적화 처리
  useEffect(() => {
    setHasError(false)
    setIsLoading(true)
    setCurrentSrc(src)
  }, [src])

  const handleError = () => {
    // 완전한 이미지 폴백 체인: WebP → JPEG → JPG → PNG
    
    // 1단계: WebP → JPEG 시도 (맥 환경 우선)
    if (currentSrc.endsWith('.webp')) {
      const jpegSrc = currentSrc.replace('.webp', '.jpeg')
      setCurrentSrc(jpegSrc)
      setIsLoading(true)
      return
    }
    
    // 2단계: JPEG → JPG 시도
    if (currentSrc.endsWith('.jpeg')) {
      const jpgSrc = currentSrc.replace('.jpeg', '.jpg')
      setCurrentSrc(jpgSrc)
      setIsLoading(true)
      return
    }
    
    // 3단계: JPG → PNG 시도
    if (currentSrc.endsWith('.jpg')) {
      const pngSrc = currentSrc.replace('.jpg', '.png')
      setCurrentSrc(pngSrc)
      setIsLoading(true)
      return
    }
    
    // 최종 실패 시에만 fallbackText 표시
    setHasError(true)
    setIsLoading(false)
  }

  const handleLoad = () => {
    setIsLoading(false)
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
    blurDataURL: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyJckliyjqTzSlT54b6bk+h0R//2Q==',
    ...(fill 
      ? { 
          fill: true, 
          // 더 세밀한 sizes 속성으로 대역폭 최적화
          sizes: sizes || '(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw'
        }
      : { 
          width: width || 800, 
          height: height || 600,
          sizes: sizes || '(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw'
        }
    )
  }

  // Progressive loading with loading indicator
  return (
    <div className={fill ? `relative ${className}` : className}>
      {isLoading && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
        </div>
      )}
      <Image 
        {...imageProps} 
        alt={alt || ''} 
        className={`transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'} ${fill ? '' : className}`}
      />
    </div>
  )
})

export default OptimizedImage
