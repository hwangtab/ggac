'use client'

import Image from 'next/image'

interface SimpleImageProps {
  src: string
  alt: string
  width: number
  height: number
  className?: string
}

const SimpleImage = ({ src, alt, width, height, className = '' }: SimpleImageProps) => {
  console.log('Loading image:', src) // 디버깅용

  return (
    <div className={`relative w-full h-full ${className}`}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className="w-full h-full object-cover"
        onError={() => {
          console.error('Image failed to load:', src)
          return (
            <div className="w-full h-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
              <span className="text-primary-600 font-medium text-center px-4">{alt}</span>
            </div>
          )
        }}
        onLoad={() => {
          console.log('Image loaded successfully:', src)
        }}
      />
    </div>
  )
}

export default SimpleImage
