'use client'

import ImageWithFallback from '@/components/ImageWithFallback'

interface ProjectImageProps {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
  preserveAspectRatio?: boolean
}

const ProjectImage = ({ 
  src, 
  alt, 
  width = 800, 
  height = 600, 
  className,
  preserveAspectRatio = false 
}: ProjectImageProps) => {
  return (
    <ImageWithFallback 
      src={src}
      alt={alt}
      width={width}
      height={height}
      fallbackText={alt}
      className={className}
      preferWebp={true}
      preserveAspectRatio={preserveAspectRatio}
    />
  )
}

export default ProjectImage
