'use client'

import { useState, useEffect } from 'react'
import AdminLayout from '../components/AdminLayout'
import ReportGenerator from '../components/ReportGenerator'
import { FiBarChart, FiTrendingUp, FiUsers, FiActivity, FiCalendar, FiEdit3, FiMusic } from 'react-icons/fi'

interface QuickStat {
  name: string
  value: string
  change: string
  trend: 'up' | 'down' | 'stable'
  icon: any
  color: string
}

export default function AdminReportsPage() {
  const [recentReports, setRecentReports] = useState<any[]>([])
  const [quickStats, setQuickStats] = useState<QuickStat[]>([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const handleReportGenerated = (report: any) => {
    setRecentReports([report, ...recentReports.slice(0, 4)]) // 최신 5개까지 유지
  }

  useEffect(() => {
    fetchQuickStats()
  }, [])

  // 자동 새로고침 효과
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchQuickStats()
      }, 30000) // 30초마다 새로고침
    }

    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [autoRefresh])

  const fetchQuickStats = async () => {
    try {
      setStatsLoading(true)
      setError(null)

      // 기본 통계 가져오기
      const [statsResponse, membersResponse, trendsResponse] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/members/stats'),
        fetch('/api/admin/analytics/trends?type=activity&weeks=4')
      ])

      if (!statsResponse.ok || !membersResponse.ok) {
        throw new Error('통계 데이터를 가져오는데 실패했습니다.')
      }

      const basicStats = await statsResponse.json()
      const memberStats = await membersResponse.json()
      const trendsData = trendsResponse.ok ? await trendsResponse.json() : null

      // 트렌드 계산
      const calculateChange = (current: number, previous: number): { change: string, trend: 'up' | 'down' | 'stable' } => {
        if (previous === 0) return { change: '+0%', trend: 'stable' }
        const percentage = ((current - previous) / previous) * 100
        const sign = percentage >= 0 ? '+' : ''
        return {
          change: `${sign}${Math.round(percentage)}%`,
          trend: percentage > 5 ? 'up' : percentage < -5 ? 'down' : 'stable'
        }
      }

      // 이번 달과 지난 달 비교를 위한 더미 데이터 (실제로는 월별 통계 API에서 가져와야 함)
      const currentMonth = {
        activities: trendsData?.summary?.총활동수 || trendsData?.summary?.totalActivities || 0,
        newMembers: basicStats.총회원수 || basicStats.totalMembers || 0,
        posts: basicStats.총게시글수 || basicStats.totalPosts || 0,
        activeUsers: memberStats.활성회원수 || memberStats.activeMembers || 0
      }

      const lastMonth = {
        activities: Math.max(0, currentMonth.activities - Math.floor(currentMonth.activities * 0.1)),
        newMembers: Math.max(0, currentMonth.newMembers - 3),
        posts: Math.max(0, currentMonth.posts - Math.floor(currentMonth.posts * 0.05)),
        activeUsers: Math.max(0, currentMonth.activeUsers - 2)
      }

      const activityTrend = calculateChange(currentMonth.activities, lastMonth.activities)
      const memberTrend = calculateChange(currentMonth.newMembers, lastMonth.newMembers)
      const postTrend = calculateChange(currentMonth.posts, lastMonth.posts)
      const sessionTrend = trendsData?.trends?.overall || { direction: 'stable', percentage: 0 }

      const stats: QuickStat[] = [
        {
          name: '이번 달 활동',
          value: currentMonth.activities.toLocaleString(),
          change: activityTrend.change,
          trend: activityTrend.trend,
          icon: FiActivity,
          color: 'blue'
        },
        {
          name: '신규 회원',
          value: (currentMonth.newMembers - lastMonth.newMembers).toString(),
          change: memberTrend.change,
          trend: memberTrend.trend,
          icon: FiUsers,
          color: 'green'
        },
        {
          name: '전체 게시글',
          value: currentMonth.posts.toString(),
          change: postTrend.change,
          trend: postTrend.trend,
          icon: FiEdit3,
          color: 'purple'
        },
        {
          name: '활성 회원',
          value: currentMonth.activeUsers.toString(),
          change: `${sessionTrend.direction === 'up' ? '+' : sessionTrend.direction === 'down' ? '-' : ''}${Math.abs(sessionTrend.percentage)}%`,
          trend: sessionTrend.direction,
          icon: FiMusic,
          color: 'orange'
        }
      ]

      setQuickStats(stats)
    } catch (err) {
      console.error('Quick stats fetch error:', err)
      setError(err instanceof Error ? err.message : '통계를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setStatsLoading(false)
    }
  }


  return (
    <AdminLayout title="리포트 및 분석" description="시스템 사용 현황과 통계를 분석합니다.">
      <div className="space-y-8">
        {/* 퀵 스탯 */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">주요 지표 (이번 달)</h2>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="autoRefresh"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="autoRefresh" className="text-sm text-gray-600">
                  자동 새로고침 (30초)
                </label>
              </div>
              <button
                onClick={fetchQuickStats}
                disabled={statsLoading}
                className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                {statsLoading ? '새로고침 중...' : '새로고침'}
              </button>
            </div>
          </div>
          
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
              <button
                onClick={fetchQuickStats}
                className="mt-2 text-sm text-red-600 hover:text-red-700 font-medium"
              >
                다시 시도
              </button>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {statsLoading ? (
              // 로딩 스켈레톤
              [...Array(4)].map((_, index) => (
                <div key={index} className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-lg"></div>
                    <div className="ml-4 flex-1">
                      <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
                      <div className="h-6 bg-gray-200 rounded w-16"></div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              quickStats.map((stat) => {
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
                            stat.trend === 'up' ? 'text-green-600' : 
                            stat.trend === 'down' ? 'text-red-600' : 'text-gray-500'
                          }`}>
                            {stat.change}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
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