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
}

const ImageWithFallback = ({
  src,
  alt,
  width,
  height,
  className = '',
  fallbackText
}: ImageWithFallbackProps) => {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const handleLoad = () => {
    console.log('Image loaded successfully:', src)
    setIsLoading(false)
  }

  const handleError = () => {
    console.log('Image failed to load:', src)
    setHasError(true)
    setIsLoading(false)
  }

  if (hasError) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
        <span className="text-primary-600 font-medium text-center px-4 text-2xl font-serif">
          {fallbackText || alt.slice(0, 3)}
        </span>
      </div>
    )
  }

  return (
    <div className={`w-full h-full relative ${className}`}>
      {(isLoading && isMounted) && (
        <div className="absolute inset-0 bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
          <span className="text-primary-600 font-medium text-center px-4 text-2xl font-serif">
            {fallbackText || alt.slice(0, 3)}
          </span>
        </div>
      )}
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={`w-full h-full object-cover ${isMounted && isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  )
}

export default ImageWithFallback
