'use client'

import { usePathname } from 'next/navigation'
import { ReactNode } from 'react'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'
import ActivityTracker from '@/components/ActivityTracker'
import type { GlobalData } from '@/types'

interface ConditionalLayoutProps {
  children: ReactNode
  globalData: GlobalData
  currentPath: string
}

export default function ConditionalLayout({
  children,
  globalData,
  currentPath,
}: ConditionalLayoutProps) {
  // usePathname()은 정적 prerender 시점에 빈 값을 반환할 수 있어,
  // 미들웨어에서 헤더로 받아온 currentPath를 fallback으로 사용한다.
  const pathnameFromHook = usePathname()
  const pathname = pathnameFromHook || currentPath
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
        <Navigation initialPath={currentPath} />
        <main id="main-content" className="flex-1 flex flex-col">
          {children}
        </main>
        <Footer globalData={globalData} />
      </div>
    </ActivityTracker>
  )
}
