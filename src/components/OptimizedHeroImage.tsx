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
  className = "", 
  style = {},
  onLoad
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
      
      {/* 메인 이미지 - AVIF/WebP/PNG 폴백 */}
      <picture>
        <source srcSet="/images/hero.avif" type="image/avif" />
        
        <Image
          src="/images/hero.png"
          alt={alt}
          fill
          className={`object-cover transition-opacity duration-700 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          } ${className}`}
          priority={true}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 100vw, 100vw"
          style={{ 
            ...style,
            willChange: imageLoaded ? 'auto' : 'opacity',
            backfaceVisibility: 'hidden',
          }}
          onLoad={handleLoad}
          onError={handleError}
          decoding="async"
          loading="eager"
          placeholder="blur"
          blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
        />
      </picture>
      
      {/* 오류 상태 처리 - PNG 폴백 시도 */}
      {imageError && (
        <div className="absolute inset-0">
          <Image 
            src="/images/hero.png"
            alt={alt}
            fill
            className="object-cover"
            priority={priority}
            onError={() => console.error('[OptimizedHeroImage] PNG 폴백도 실패')}
            onLoad={() => {
              console.log('[OptimizedHeroImage] PNG 폴백 로드 성공')
              setImageLoaded(true)
              setImageError(false)
            }}
          />
          {/* 최종 실패 시 UI */}
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
            <div className="text-white text-center">
              <div className="w-12 h-12 mx-auto mb-2 opacity-50">
                <svg fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                </svg>
              </div>
              <p className="text-sm opacity-70">이미지 로딩 실패</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(OptimizedHeroImage)