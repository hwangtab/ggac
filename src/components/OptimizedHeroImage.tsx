'use client'

import Image from 'next/image'

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
  return (
    <Image
      src="/images/hero.webp"
      alt={alt}
      fill
      className={`object-cover ${className}`}
      priority={priority}
      sizes="100vw"
      style={{ 
        ...style,
        willChange: 'transform',
        backfaceVisibility: 'hidden'
      }}
      placeholder="empty"
    />
  )
}

export default OptimizedHeroImage