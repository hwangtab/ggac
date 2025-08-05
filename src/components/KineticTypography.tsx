'use client'

import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

interface KineticTypographyProps {
  children: React.ReactNode
  variant?: 'hero' | 'kinetic' | 'shimmer'
  className?: string
  delay?: number
  duration?: number
}

const KineticTypography: React.FC<KineticTypographyProps> = ({
  children,
  variant = 'kinetic',
  className = '',
  delay = 0,
  duration = 4000
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  // If user prefers reduced motion, show static text with gradient
  if (prefersReducedMotion) {
    return (
      <div 
        className={`
          ${variant === 'hero' ? 'heading-hero' : ''}
          ${variant === 'kinetic' ? 'text-kinetic' : ''}
          ${variant === 'shimmer' ? 'heading-hero' : ''}
          ${className}
        `}
        style={{ 
          animation: 'none',
          background: variant === 'hero' || variant === 'shimmer' 
            ? 'linear-gradient(135deg, #00d4ff, #ff0099)'
            : 'linear-gradient(45deg, #00ff88, #ff0099, #ffd700, #00d4ff)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          color: 'transparent'
        }}
      >
        {children}
      </div>
    )
  }

  const getVariantClasses = () => {
    switch (variant) {
      case 'hero':
        return 'heading-hero'
      case 'shimmer':
        return 'heading-hero animate-text-shimmer'
      case 'kinetic':
      default:
        return 'text-kinetic'
    }
  }

  return (
    <div 
      className={`
        ${getVariantClasses()}
        ${isVisible ? 'opacity-100' : 'opacity-0'}
        transition-opacity duration-1000
        ${className}
      `}
      style={{
        animationDuration: `${duration}ms`
      }}
    >
      {children}
    </div>
  )
}

export default KineticTypography