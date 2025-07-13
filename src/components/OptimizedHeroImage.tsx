'use client'

import Image from 'next/image'
import { useState } from 'react'

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

  const handleLoad = () => {
    setImageLoaded(true)
    onLoad?.()
  }

  const handleError = () => {
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
      
      {/* 메인 이미지 - 다중 포맷 지원 */}
      <picture>
        <source srcSet="/images/hero.avif" type="image/avif" />
        <source srcSet="/images/hero.webp" type="image/webp" />
        <Image
          src="/images/hero.webp"
          alt={alt}
          fill
          className={`object-cover transition-opacity duration-700 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          } ${className}`}
          priority={priority}
          sizes="100vw"
          style={{ 
            ...style,
            willChange: imageLoaded ? 'auto' : 'opacity', // 로딩 후 GPU 레이어 해제
            backfaceVisibility: 'hidden',
          }}
          onLoad={handleLoad}
          onError={handleError}
          // 성능 최적화 속성
          decoding="async"
          loading={priority ? "eager" : "lazy"}
          placeholder="empty"
        />
      </picture>
      
      {/* 오류 상태 처리 */}
      {imageError && (
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
      )}
    </div>
  )
}

export default OptimizedHeroImage