'use client'

import { ReactNode } from 'react'
import {
  FiHome,
  FiUsers,
  FiMusic,
  FiEdit3,
  FiSettings,
  FiBarChart,
  FiLogOut,
  FiClipboard,
} from 'react-icons/fi'
import { Link, usePathname } from '@/i18n/navigation'

interface AdminLayoutProps {
  title: string
  description?: string
  children: ReactNode
}

interface AdminMenuItem {
  id: string
  label: string
  href: string
  icon: ReactNode
  badge?: string
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ title, description, children }) => {
  const pathname = usePathname()

  const menuItems: AdminMenuItem[] = [
    {
      id: 'dashboard',
      label: '대시보드',
      href: '/admin',
      icon: <FiHome className="w-5 h-5" />,
    },
    {
      id: 'members',
      label: '회원 관리',
      href: '/admin/members',
      icon: <FiUsers className="w-5 h-5" />,
    },
    {
      id: 'artists',
      label: '아티스트 관리',
      href: '/admin/artists',
      icon: <FiMusic className="w-5 h-5" />,
    },
    {
      id: 'posts',
      label: '게시글 관리',
      href: '/admin/posts',
      icon: <FiEdit3 className="w-5 h-5" />,
    },
    {
      id: 'reports',
      label: '리포트 및 분석',
      href: '/admin/reports',
      icon: <FiBarChart className="w-5 h-5" />,
    },
    {
      id: 'event-applications',
      label: '행사 신청 내역',
      href: '/admin/event-applications',
      icon: <FiClipboard className="w-5 h-5" />,
    },
    {
      id: 'settings',
      label: '시스템 설정',
      href: '/admin/settings',
      icon: <FiSettings className="w-5 h-5" />,
    },
  ]

  const isActive = (href: string) => {
    if (href === '/admin') {
      return pathname === '/admin'
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex admin-page">
      {/* 사이드바 */}
      <div className="fixed inset-y-0 left-0 z-40 w-64 bg-white shadow-lg flex flex-col">
        {/* 로고 */}
        <div className="flex items-center px-6 py-4 border-b border-gray-200">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-accent-500 rounded-lg flex items-center justify-center">
              <FiBarChart className="w-5 h-5 text-white" />
            </div>
            <div className="ml-3">
              <p className="text-lg font-semibold text-gray-900">관리자 패널</p>
              <p className="text-xs text-gray-500">GGAC Admin</p>
            </div>
          </div>
        </div>

        {/* 메뉴 */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <ul className="space-y-1">
            {menuItems.map(item => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive(item.href)
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {item.icon}
                  <span className="ml-3">{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* 하단 메뉴 */}
        <div className="p-3 border-t border-gray-200">
          <Link
            href="/mypage"
            className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            <FiLogOut className="w-5 h-5" />
            <span className="ml-3">마이페이지로</span>
          </Link>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="flex-1 pl-64 flex flex-col">
        {/* 헤더 */}
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
            {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
          </div>
        </header>

        {/* 콘텐츠 */}
        <main className="flex-1 px-6 py-6">{children}</main>

        {/* 간단한 푸터 */}
        <footer className="bg-white border-t border-gray-200 px-6 py-4 mt-auto">
          <div className="text-center text-sm text-gray-500">
            © 2025 경기아트콜렉티브 관리시스템. All rights reserved.
          </div>
        </footer>
      </div>
    </div>
  )
}

export default AdminLayout
