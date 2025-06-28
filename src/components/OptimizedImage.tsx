'use client'

import Image from 'next/image'
import { useState } from 'react'

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
}

export default function OptimizedImage({
  src,
  alt,
  width,
  height,
  className = '',
  priority = false,
  fill = false,
  sizes,
  quality = 85,
  fallbackText
}: OptimizedImageProps) {
  const [hasError, setHasError] = useState(false)

  const handleError = () => {
    setHasError(true)
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

  return <Image {...imageProps} />
}
