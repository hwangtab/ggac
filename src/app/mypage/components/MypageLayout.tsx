'use client'

import { usePathname } from 'next/navigation'
import { MypageLayoutProps } from '@/types'
import MypageNavigation from './MypageNavigation'

const MypageLayout: React.FC<MypageLayoutProps> = ({ 
  children, 
  title, 
  description,
  className = ''
}) => {
  const pathname = usePathname()
  
  return (
    <div className={`min-h-screen bg-gray-50 ${className}`}>
      <div className="pt-20"> {/* Navigation height offset */}
        <div className="container-custom py-8">
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-4 gap-8">
              {/* 사이드바 네비게이션 */}
              <div className="lg:col-span-1">
                <div className="lg:sticky lg:top-28">
                  <MypageNavigation currentPath={pathname} />
                </div>
              </div>
              
              {/* 메인 콘텐츠 */}
              <div className="lg:col-span-3">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  {/* 헤더 */}
                  <div className="bg-gradient-to-r from-primary-50 to-accent-50 px-6 py-8 border-b border-gray-200">
                    <div className="max-w-4xl">
                      <h1 className="text-2xl font-bold text-gray-900 mb-2">
                        {title}
                      </h1>
                      {description && (
                        <p className="text-gray-600 text-sm leading-relaxed">
                          {description}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {/* 콘텐츠 */}
                  <div className="p-6">
                    {children}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MypageLayout