'use client'

import { usePathname } from 'next/navigation'
import { ReactNode } from 'react'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'
import type { GlobalData } from '@/types'

interface ConditionalLayoutProps {
  children: ReactNode
  globalData: GlobalData
}

export default function ConditionalLayout({ children, globalData }: ConditionalLayoutProps) {
  const pathname = usePathname()
  const isAdminPage = pathname.startsWith('/admin')

  if (isAdminPage) {
    // 관리자 페이지에서는 Navigation과 Footer 없이 children만 렌더링
    return <main id="main-content" className="min-h-screen">{children}</main>
  }

  // 일반 페이지에서는 기존 레이아웃 사용
  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />
      <main id="main-content" className="flex-1">{children}</main>
      <Footer globalData={globalData} />
    </div>
  )
}