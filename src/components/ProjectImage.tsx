'use client'

import ImageWithFallback from '@/components/ImageWithFallback'

interface ProjectImageProps {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
}

const ProjectImage = ({ src, alt, width = 800, height = 600, className }: ProjectImageProps) => {
  return (
    <ImageWithFallback 
      src={src}
      alt={alt}
      width={width}
      height={height}
      fallbackText={alt}
      className={className}
    />
  )
}

export default ProjectImage
