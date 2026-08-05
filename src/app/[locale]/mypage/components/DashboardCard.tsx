'use client'

import { Link } from '@/i18n/navigation'
import { FiArrowRight } from 'react-icons/fi'

interface DashboardCardProps {
  title: string
  description: string
  icon: React.ReactNode
  href?: string
  buttonText?: string
  disabled?: boolean
  badge?: string
  className?: string
}

const DashboardCard: React.FC<DashboardCardProps> = ({
  title,
  description,
  icon,
  href,
  buttonText,
  disabled = false,
  badge,
  className = '',
}) => {
  const cardContent = (
    <div
      className={`
      bg-white rounded-lg border border-gray-200 p-6 transition-all duration-200
      min-h-[200px] flex flex-col justify-between
      ${
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'hover:shadow-md hover:border-primary-300 hover:-translate-y-1 cursor-pointer'
      }
      ${className}
    `}
    >
      {/* 상단 영역: 아이콘, 제목, 배지 */}
      <div>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            {icon}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
              {badge && (
                <span className="inline-block mt-1 px-2 py-1 text-xs bg-accent-100 text-accent-700 rounded">
                  {badge}
                </span>
              )}
            </div>
          </div>
          {!disabled && (
            <FiArrowRight className="w-5 h-5 text-gray-400 transition-transform duration-200 group-hover:translate-x-1" />
          )}
        </div>

        {/* 설명 텍스트 */}
        <p className="text-gray-600 text-sm leading-relaxed">{description}</p>
      </div>

      {/* 하단 영역: 버튼 (있는 경우) */}
      {buttonText && !disabled && (
        <div className="flex justify-end mt-4 pt-2">
          <span className="text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors duration-200">
            {buttonText}
          </span>
        </div>
      )}
    </div>
  )

  if (disabled || !href) {
    return cardContent
  }

  return (
    <Link href={href} className="block group">
      {cardContent}
    </Link>
  )
}

export default DashboardCard
