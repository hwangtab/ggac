'use client'

import { useState } from 'react'
import AdminLayout from '../components/AdminLayout'
import ReportGenerator from '../components/ReportGenerator'
import { FiBarChart, FiTrendingUp, FiUsers, FiActivity, FiCalendar } from 'react-icons/fi'

export default function AdminReportsPage() {
  const [recentReports, setRecentReports] = useState<any[]>([])

  const handleReportGenerated = (report: any) => {
    setRecentReports([report, ...recentReports.slice(0, 4)]) // 최신 5개까지 유지
  }

  const quickStats = [
    {
      name: '이번 달 활동',
      value: '1,234',
      change: '+12%',
      trend: 'up',
      icon: FiActivity,
      color: 'blue'
    },
    {
      name: '신규 회원',
      value: '45',
      change: '+8%',
      trend: 'up',
      icon: FiUsers,
      color: 'green'
    },
    {
      name: '게시글 참여도',
      value: '89%',
      change: '+5%',
      trend: 'up',
      icon: FiTrendingUp,
      color: 'purple'
    },
    {
      name: '평균 세션',
      value: '24분',
      change: '+3%',
      trend: 'up',
      icon: FiCalendar,
      color: 'orange'
    }
  ]

  return (
    <AdminLayout title="리포트 및 분석" description="시스템 사용 현황과 통계를 분석합니다.">
      <div className="space-y-8">
        {/* 퀵 스탯 */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">주요 지표 (이번 달)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {quickStats.map((stat) => {
              const IconComponent = stat.icon
              return (
                <div key={stat.name} className="bg-white rounded-lg border border-gray-200 p-6">
                  <div className="flex items-center">
                    <div className={`flex-shrink-0 w-10 h-10 bg-${stat.color}-100 rounded-lg flex items-center justify-center`}>
                      <IconComponent className={`w-5 h-5 text-${stat.color}-600`} />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                      <div className="flex items-baseline">
                        <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
                        <p className={`ml-2 text-sm font-medium ${
                          stat.trend === 'up' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {stat.change}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 리포트 생성기 */}
        <ReportGenerator onReportGenerated={handleReportGenerated} />

        {/* 최근 생성된 리포트 */}
        {recentReports.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">최근 생성된 리포트</h3>
            <div className="space-y-3">
              {recentReports.map((report, index) => (
                <div
                  key={`${report.metadata.type}-${report.metadata.generatedAt}-${index}`}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center">
                    <FiBarChart className="w-5 h-5 text-gray-600 mr-3" />
                    <div>
                      <p className="font-medium text-gray-900">
                        {report.metadata.type === 'comprehensive' ? '종합 리포트' :
                         report.metadata.type === 'member_activity' ? '멤버 활동 리포트' :
                         report.metadata.type === 'post_engagement' ? '게시글 참여도 리포트' :
                         report.metadata.type === 'user_registration' ? '신규 가입 리포트' : '알 수 없는 리포트'}
                      </p>
                      <p className="text-sm text-gray-600">
                        {new Date(report.metadata.generatedAt).toLocaleString('ko-KR')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-500">
                      {new Date(report.metadata.dateRange.start).toLocaleDateString('ko-KR')} ~ {new Date(report.metadata.dateRange.end).toLocaleDateString('ko-KR')}
                    </span>
                    <button
                      onClick={() => {
                        const dataStr = JSON.stringify(report, null, 2)
                        const dataBlob = new Blob([dataStr], { type: 'application/json' })
                        const url = URL.createObjectURL(dataBlob)
                        const link = document.createElement('a')
                        link.href = url
                        link.download = `report_${report.metadata.type}_${report.metadata.generatedAt.split('T')[0]}.json`
                        link.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                    >
                      다운로드
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 리포트 활용 가이드 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-start">
            <FiBarChart className="w-6 h-6 text-blue-600 mt-1" />
            <div className="ml-3">
              <h3 className="text-lg font-semibold text-blue-900 mb-2">리포트 활용 가이드</h3>
              <div className="text-blue-800 space-y-2">
                <p><strong>종합 리포트:</strong> 전체 시스템 상태를 한눈에 파악할 수 있습니다.</p>
                <p><strong>멤버 활동 리포트:</strong> 사용자들의 참여 패턴과 활동 수준을 분석합니다.</p>
                <p><strong>게시글 참여도 리포트:</strong> 콘텐츠의 인기도와 사용자 반응을 측정합니다.</p>
                <p><strong>신규 가입 리포트:</strong> 회원 증가 추세와 승인 현황을 모니터링합니다.</p>
              </div>
              <div className="mt-4 text-sm text-blue-700">
                💡 <strong>팁:</strong> 리포트를 정기적으로 생성하여 시간에 따른 변화를 추적하세요.
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}