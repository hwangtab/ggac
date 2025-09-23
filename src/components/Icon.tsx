'use client'

import { ElementType } from 'react'

interface IconProps {
  as: ElementType
  className?: string
  strokeWidth?: number
}

/**
 * react-icons의 시각적 크기 불일치 문제를 해결하기 위한 래퍼 컴포넌트입니다.
 *
 * @param {ElementType} as - 렌더링할 아이콘 컴포넌트 (예: FiUser)
 * @param {string} [className] - 아이콘 컨테이너에 적용할 Tailwind 클래스 (크기, 색상 등)
 * @param {number} [strokeWidth] - 아이콘 선 굵기
 */
export const Icon = ({ as: IconComponent, className, strokeWidth = 1.5 }: IconProps) => {
  // 기본 아이콘 컨테이너 스타일: flex를 이용해 내부 아이콘을 중앙 정렬합니다.
  // w-4, h-4와 같은 크기 클래스는 이 컨테이너에 적용됩니다.
  const containerClasses = `inline-flex items-center justify-center ${className || ''}`

  // 실제 아이콘에 적용될 스타일: 컨테이너를 꽉 채우도록 설정합니다.
  const iconClasses = 'w-full h-full'

  return (
    <span className={containerClasses}>
      <IconComponent className={iconClasses} style={{ strokeWidth }} />
    </span>
  )
}
