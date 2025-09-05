'use client'

import Image from 'next/image'
import { useState, memo } from 'react'

interface OptimizedHeroImageProps {
  alt: string
  priority?: boolean
  className?: string
  style?: React.CSSProperties
  onLoad?: () => void
}

const OptimizedHeroImage = ({
  alt,
  priority = false,
  className = '',
  style = {},
  onLoad,
}: OptimizedHeroImageProps) => {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  // 디버깅: 컴포넌트 마운트 시 로그
  if (process.env.NODE_ENV === 'development') {
    console.log('[OptimizedHeroImage] 컴포넌트 렌더링', { imageLoaded, imageError })
  }

  const handleLoad = () => {
    console.log('[OptimizedHeroImage] 이미지 로드 완료')
    setImageLoaded(true)
    onLoad?.()
  }

  const handleError = () => {
    console.error('[OptimizedHeroImage] 이미지 로드 실패')
    setImageError(true)
  }

  return (
    <div className="relative w-full h-full">
      {/* 최적화된 블러 플레이스홀더 - 레이아웃 시프트 방지 */}
      {!imageLoaded && (
        <div
          className="absolute inset-0"
          style={{
            background: `
              linear-gradient(135deg, 
                #1a1a1a 0%, 
                #2d2d2d 25%, 
                #1f1f1f 50%, 
                #151515 75%, 
                #0a0a0a 100%
              )
            `,
            // 미세한 노이즈 패턴으로 시각적 품질 향상
            backgroundImage: `url("data:image/svg+xml;base64,${btoa(`
              <svg width="60" height="60" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="noise" width="60" height="60" patternUnits="userSpaceOnUse">
                    <circle cx="15" cy="15" r="0.8" fill="rgba(255,255,255,0.08)"/>
                    <circle cx="45" cy="25" r="0.6" fill="rgba(255,255,255,0.06)"/>
                    <circle cx="30" cy="45" r="0.7" fill="rgba(255,255,255,0.07)"/>
                    <circle cx="50" cy="10" r="0.5" fill="rgba(255,255,255,0.05)"/>
                  </pattern>
                </defs>
                <rect width="60" height="60" fill="url(#noise)"/>
              </svg>
            `)}")`,
            filter: 'blur(20px)',
            transform: 'scale(1.1)', // 블러 경계 숨김
            willChange: 'opacity',
          }}
        />
      )}

      {/* 메인 이미지 - Next Image 단일 사용 (Next가 AVIF/WebP 자동 서빙 및 올바른 프리로드 처리) */}
      <Image
        src="/images/hero.png"
        alt={alt}
        fill
        className={`object-cover transition-opacity duration-700 ${
          imageLoaded ? 'opacity-100' : 'opacity-0'
        } ${className}`}
        priority={priority}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 100vw, 100vw"
        style={{
          ...style,
          willChange: imageLoaded ? 'auto' : 'opacity',
          backfaceVisibility: 'hidden',
        }}
        onLoad={handleLoad}
        onError={handleError}
        placeholder="blur"
        blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
        fetchPriority={priority ? 'high' : undefined}
      />

      {/* 오류 상태 처리 - PNG 폴백 시도 */}
      {imageError && <div className="absolute inset-0 bg-gray-900/60" />}
    </div>
  )
}

export default memo(OptimizedHeroImage)
