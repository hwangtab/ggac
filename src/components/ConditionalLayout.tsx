'use client'

import { usePathname } from '@/i18n/navigation'
import { ReactNode } from 'react'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'
import ActivityTracker from '@/components/ActivityTracker'
import type { GlobalData } from '@/types'

interface ConditionalLayoutProps {
  children: ReactNode
  globalData: GlobalData
}

export default function ConditionalLayout({ children, globalData }: ConditionalLayoutProps) {
  // 정적 prerender 시점에는 usePathname()이 빈 값일 수 있다.
  // 그 경우 hydration 직후 정확한 path가 채워지며, 일반 라우트에서는
  // 빈 값일 때 isAdminPage=false로 떨어져 일반 레이아웃이 SSR된다.
  const pathname = usePathname() || ''
  const isAdminPage = pathname.startsWith('/admin')

  if (isAdminPage) {
    // 관리자 페이지에서는 Navigation과 Footer 없이 children만 렌더링
    return (
      <ActivityTracker>
        <main id="main-content" className="min-h-screen">
          {children}
        </main>
      </ActivityTracker>
    )
  }

  // 일반 페이지에서는 기존 레이아웃 사용
  return (
    <ActivityTracker>
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <main id="main-content" className="flex-1 flex flex-col">
          {children}
        </main>
        <Footer globalData={globalData} />
      </div>
    </ActivityTracker>
  )
}
