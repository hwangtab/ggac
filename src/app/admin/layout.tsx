import { ReactNode } from 'react'

interface AdminRootLayoutProps {
  children: ReactNode
}

export default function AdminRootLayout({ children }: AdminRootLayoutProps) {
  return (
    <div className="admin-layout">
      {/* 관리자 페이지에서는 일반 웹사이트 레이아웃을 사용하지 않음 */}
      {children}
    </div>
  )
}