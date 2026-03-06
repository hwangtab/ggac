import React from 'react'

interface BentoGridItemProps {
  children: React.ReactNode
  className?: string
  size?: 'small' | 'wide' | 'tall' | 'large'
}

const BentoGridItem: React.FC<BentoGridItemProps> = ({
  children,
  className = '',
  size = 'small',
}) => {
  const sizeClasses = {
    small: 'bento-small',
    wide: 'bento-wide',
    tall: 'bento-tall',
    large: 'bento-large',
  }

  // Generate dynamic gradient based on size
  const getGradientClass = () => {
    switch (size) {
      case 'large':
        return 'gradient-electric'
      case 'wide':
        return 'gradient-neon'
      case 'tall':
        return 'gradient-cosmic'
      case 'small':
      default:
        return 'gradient-gold'
    }
  }

  return (
    <div
      className={`
      bento-item 
      ${sizeClasses[size]} 
      ${getGradientClass()}
      p-6
      relative
      group
      cursor-pointer
      ${className}
    `}
    >
      {/* Gradient overlay for content readability */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/40 via-transparent to-black/60 rounded-[24px]" />

      {/* Content container with glass effect */}
      <div className="relative h-full flex flex-col justify-end text-white">
        <div className="creative-post-card p-4 backdrop-blur-sm">{children}</div>
      </div>

      {/* Hover effect particles */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-300 pointer-events-none">
        <div className="absolute top-4 left-4 w-2 h-2 bg-white rounded-full animate-pulse" />
        <div className="absolute top-8 right-6 w-1 h-1 bg-white rounded-full animate-pulse delay-100" />
        <div className="absolute bottom-6 left-8 w-1.5 h-1.5 bg-white rounded-full animate-pulse delay-200" />
      </div>
    </div>
  )
}

interface BentoGridShowcaseProps {
  children: React.ReactNode
  className?: string
}

const BentoGridShowcase: React.FC<BentoGridShowcaseProps> = ({ children, className = '' }) => {
  return (
    <div
      className={`
      bento-grid 
      responsive
      grid-cols-1 sm:grid-cols-2 lg:grid-cols-4
      grid-rows-auto lg:grid-rows-3
      gap-4 lg:gap-6
      min-h-[400px] lg:h-[600px]
      p-4
      ${className}
    `}
    >
      {children}
    </div>
  )
}

export { BentoGridShowcase, BentoGridItem }
