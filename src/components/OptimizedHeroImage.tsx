'use client'

import Image from 'next/image'
import { useState } from 'react'

interface OptimizedHeroImageProps {
  alt: string
  priority?: boolean
  className?: string
  style?: React.CSSProperties
}

const OptimizedHeroImage = ({ 
  alt, 
  priority = false, 
  className = "", 
  style = {} 
}: OptimizedHeroImageProps) => {
  const [imageError, setImageError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // 이미지 포맷 우선순위: AVIF > WebP > PNG
  const getImageSrc = () => {
    if (imageError) {
      return '/images/hero.png' // Fallback
    }
    
    // AVIF 지원 확인 (실제로는 서버에서 AVIF 파일이 있는지 확인해야 함)
    // 현재는 WebP를 사용하고, 추후 AVIF 변환 도구 설치 후 적용
    return '/images/hero.webp'
  }

  const handleImageLoad = () => {
    setIsLoading(false)
  }

  const handleImageError = () => {
    setImageError(true)
    setIsLoading(false)
  }

  return (
    <>
      {/* 블러 플레이스홀더 */}
      {isLoading && (
        <div 
          className="absolute inset-0 bg-gradient-to-br from-gray-700 to-gray-900 animate-pulse"
          style={{ 
            filter: 'blur(20px)',
            transform: 'scale(1.1)',
            zIndex: 1
          }}
        />
      )}
      
      {/* 메인 이미지 */}
      <Image
        src={getImageSrc()}
        alt={alt}
        fill
        className={`object-cover transition-opacity duration-300 ${
          isLoading ? 'opacity-0' : 'opacity-100'
        } ${className}`}
        priority={priority}
        sizes="100vw"
        onLoad={handleImageLoad}
        onError={handleImageError}
        style={{ 
          ...style,
          willChange: 'transform',
          backfaceVisibility: 'hidden'
        }}
        placeholder="blur"
        blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
      />
      
      {/* WebP Fallback */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ 
          backgroundImage: 'url(/images/hero.webp)',
          display: imageError ? 'block' : 'none',
          zIndex: 0
        }}
      />
      
      {/* PNG Fallback */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ 
          backgroundImage: 'url(/images/hero.png)',
          display: 'none' // 최후의 수단
        }}
      />
    </>
  )
}

export default OptimizedHeroImage