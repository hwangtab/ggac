'use client'

import { useState, useEffect, Suspense } from 'react'
import dynamic from 'next/dynamic'
import {
  FiUsers,
  FiMusic,
  FiEdit3,
  FiSettings,
  FiBarChart,
  FiShield,
  FiClipboard,
} from 'react-icons/fi'
import AdminLayout from './components/AdminLayout'
import DashboardStats from './components/DashboardStats'
import RecentActivity from './components/RecentActivity'
import RealTimeActivityMonitor from './components/RealTimeActivityMonitor'

// 큰 컴포넌트들을 동적 로딩으로 변경
const ActivityAnalyticsCharts = dynamic(() => import('./components/ActivityAnalyticsCharts'), {
  loading: () => (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-64 bg-gray-100 rounded"></div>
      </div>
    </div>
  ),
  ssr: false,
})

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalMembers: 0,
    pendingApprovals: 0,
    totalPosts: 0,
    activeArtists: 0,
  })

  useEffect(() => {
    // 통계 데이터 로드
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/admin/stats')
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }

  const quickActions = [
    {
      title: '회원 관리',
      description: '회원 승인, 거부 및 상태 관리',
      icon: <FiUsers className="w-6 h-6" />,
      href: '/admin/members',
      count: stats.pendingApprovals,
      countLabel: '승인 대기',
    },
    {
      title: '아티스트 관리',
      description: '아티스트 권한 및 프로필 관리',
      icon: <FiMusic className="w-6 h-6" />,
      href: '/admin/artists',
      count: stats.activeArtists,
      countLabel: '활성 아티스트',
    },
    {
      title: '게시글 관리',
      description: '게시글 및 댓글 관리',
      icon: <FiEdit3 className="w-6 h-6" />,
      href: '/admin/posts',
      count: stats.totalPosts,
      countLabel: '전체 게시글',
    },
    {
      title: '시스템 설정',
      description: '사이트 설정 및 관리',
      icon: <FiSettings className="w-6 h-6" />,
      href: '/admin/settings',
      count: null,
      countLabel: null,
    },
    {
      title: '행사 신청 내역',
      description: '공연·판매 신청 조회 및 선정 관리',
      icon: <FiClipboard className="w-6 h-6" />,
      href: '/admin/event-applications',
      count: null,
      countLabel: null,
    },
  ]

  return (
    <AdminLayout title="관리자 대시보드" description="경기아트콜렉티브 관리 시스템">
      <div className="space-y-6">
        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <DashboardStats
            title="전체 회원"
            value={stats.totalMembers}
            icon={<FiUsers className="w-5 h-5" />}
            color="blue"
          />
          <DashboardStats
            title="승인 대기"
            value={stats.pendingApprovals}
            icon={<FiShield className="w-5 h-5" />}
            color="yellow"
          />
          <DashboardStats
            title="전체 게시글"
            value={stats.totalPosts}
            icon={<FiEdit3 className="w-5 h-5" />}
            color="green"
          />
          <DashboardStats
            title="활성 아티스트"
            value={stats.activeArtists}
            icon={<FiMusic className="w-5 h-5" />}
            color="purple"
          />
        </div>

        {/* 빠른 작업 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">빠른 작업</h2>
            <p className="text-sm text-gray-600 mt-1">자주 사용하는 관리 기능들</p>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {quickActions.map((action, index) => (
                <a
                  key={index}
                  href={action.href}
                  className="flex items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex-shrink-0 w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
                    {action.icon}
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-sm font-medium text-gray-900">{action.title}</h3>
                    <p className="text-sm text-gray-500 mt-1">{action.description}</p>
                  </div>
                  {action.count !== null && (
                    <div className="flex-shrink-0 text-right">
                      <div className="text-lg font-semibold text-gray-900">{action.count}</div>
                      <div className="text-xs text-gray-500">{action.countLabel}</div>
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* 실시간 활동 모니터링 */}
        <RealTimeActivityMonitor />

        {/* 활동 분석 차트 */}
        <ActivityAnalyticsCharts days={30} />

        {/* 최근 활동 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">최근 활동</h2>
            <p className="text-sm text-gray-600 mt-1">최근 7일간의 시스템 활동</p>
          </div>
          <div className="p-6">
            <RecentActivity />
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
