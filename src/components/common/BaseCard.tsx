'use client'

import { memo, ReactNode } from 'react'
import Link from 'next/link'
import OptimizedImage from '@/components/OptimizedImage'
import type { OptimizedImageProps } from '@/types'

export interface BaseCardProps {
  /** 카드 제목 */
  title: string
  /** 카드 설명/내용 */
  description: string
  /** 카테고리 라벨 */
  category?: string
  /** 이미지 정보 */
  image?: {
    src: string
    alt: string
    width?: number
    height?: number
  }
  /** 링크 URL */
  href?: string
  /** 날짜 정보 */
  date?: string
  /** 작성자/아티스트 정보 */
  author?: string
  /** 추가 CSS 클래스 */
  className?: string
  /** 카드 변형 타입 */
  variant?: 'default' | 'compact' | 'featured'
  /** 호버 효과 여부 */
  hoverable?: boolean
  /** 이미지 위치 */
  imagePosition?: 'top' | 'left' | 'right'
  /** 커스텀 푸터 콘텐츠 */
  footer?: ReactNode
  /** 클릭 핸들러 (href가 없을 때) */
  onClick?: () => void
}

const BaseCard = memo(function BaseCard({
  title,
  description,
  category,
  image,
  href,
  date,
  author,
  className = '',
  variant = 'default',
  hoverable = true,
  imagePosition = 'top',
  footer,
  onClick,
}: BaseCardProps) {
  // 카드 스타일 계산
  const getCardStyles = () => {
    const baseStyles = 'bg-white rounded-2xl shadow-lg overflow-hidden'
    const hoverStyles = hoverable
      ? 'hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2'
      : ''
    const cursorStyles = href || onClick ? 'cursor-pointer' : ''

    const variantStyles = {
      default: 'h-full flex flex-col',
      compact: 'h-auto',
      featured: 'h-full flex flex-col border-2 border-primary-100',
    }

    return `${baseStyles} ${hoverStyles} ${cursorStyles} ${variantStyles[variant]} ${className}`
  }

  // 카테고리 배지 스타일
  const getCategoryStyles = () => {
    return 'inline-block px-3 py-1 bg-primary-100 text-primary-700 text-sm font-medium rounded-full'
  }

  // 이미지 렌더링
  const renderImage = () => {
    if (!image) return null

    const imageClasses = {
      top: 'w-full h-48',
      left: 'w-32 h-32 flex-shrink-0',
      right: 'w-32 h-32 flex-shrink-0',
    }

    return (
      <div
        className={`relative overflow-hidden ${imageClasses[imagePosition]} ${imagePosition === 'top' ? 'flex-shrink-0' : ''}`}
      >
        <OptimizedImage
          src={image.src}
          alt={image.alt}
          width={image.width || 600}
          height={image.height || 400}
          className="object-cover w-full h-full"
          sizes="(max-width: 768px) 100vw, 600px"
        />
        {hoverable && (
          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-300" />
        )}
      </div>
    )
  }

  // 콘텐츠 렌더링
  const renderContent = () => (
    <div className="p-6 flex-grow flex flex-col">
      {/* 헤더: 카테고리와 날짜 */}
      {(category || date) && (
        <div className="flex items-center justify-between mb-3">
          {category && <span className={getCategoryStyles()}>{category}</span>}
          {date && <span className="text-sm text-gray-500">{date}</span>}
        </div>
      )}

      {/* 제목 */}
      <h3
        className={`font-serif font-semibold mb-2 transition-colors duration-200 ${
          variant === 'featured' ? 'text-2xl' : 'text-xl'
        } ${hoverable ? 'group-hover:text-primary-600' : ''}`}
      >
        {title}
      </h3>

      {/* 설명 */}
      <p
        className={`text-gray-600 mb-3 flex-grow ${
          variant === 'compact' ? 'text-sm line-clamp-2' : 'text-sm line-clamp-3'
        }`}
      >
        {description}
      </p>

      {/* 작성자 정보 */}
      {author && <p className="text-xs text-gray-500 mt-auto">{author}</p>}

      {/* 커스텀 푸터 */}
      {footer && <div className="mt-3 pt-3 border-t border-gray-100">{footer}</div>}
    </div>
  )

  // 카드 내용 구성
  const cardContent = (
    <div className={`group ${getCardStyles()}`}>
      {imagePosition === 'top' && renderImage()}

      {imagePosition === 'left' && (
        <div className="flex">
          {renderImage()}
          {renderContent()}
        </div>
      )}

      {imagePosition === 'right' && (
        <div className="flex">
          {renderContent()}
          {renderImage()}
        </div>
      )}

      {imagePosition === 'top' && renderContent()}
    </div>
  )

  // 링크 래핑 또는 클릭 핸들러
  if (href) {
    return (
      <Link href={href} className="block">
        {cardContent}
      </Link>
    )
  }

  if (onClick) {
    return (
      <div onClick={onClick} className="block">
        {cardContent}
      </div>
    )
  }

  return cardContent
})

export default BaseCard
