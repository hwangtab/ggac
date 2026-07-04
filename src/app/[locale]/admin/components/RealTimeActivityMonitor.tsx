'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FiUsers,
  FiActivity,
  FiClock,
  FiTrendingUp,
  FiRefreshCw,
  FiEye,
  FiBarChart,
} from 'react-icons/fi'

interface ActiveUser {
  user_id: string
  display_name: string
  email: string
  last_activity: string
  ip_address: string
  activity_count_today: number
  session_token: string
  minutes_since_activity: number
}

interface RecentActivity {
  id: string
  user_id: string
  user_name: string
  action_type: string
  target_type: string
  target_id: string
  metadata: Record<string, any>
  created_at: string
  time_ago_text: string
}

interface ActivityStatistics {
  활성사용자수: number
  총세션수: number
  시간대별세션수: Record<string, number>
  평균세션시간: number
}

interface RealTimeData {
  activeUsers: ActiveUser[]
  recentActivity: RecentActivity[]
  statistics: ActivityStatistics
  metadata: {
    generatedAt: string
    refreshInterval: number
    includeActivity: boolean
  }
}

interface RealTimeActivityMonitorProps {
  refreshInterval?: number
  showRecentActivity?: boolean
}

const RealTimeActivityMonitor: React.FC<RealTimeActivityMonitorProps> = ({
  refreshInterval = 30000, // 30초
  showRecentActivity = true,
}) => {
  const [data, setData] = useState<RealTimeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchRealTimeData = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        include_activity: showRecentActivity.toString(),
        limit: '20',
      })

      const response = await fetch(`/api/admin/activities/real-time?${params}`)
      if (!response.ok) {
        throw new Error(`서버 오류: ${response.status}`)
      }

      const newData = await response.json()
      // 폴링 응답은 표준 래퍼(ApiSuccess) 형식: 실제 payload는 data 안에 있다.
      // SSE 스트림(/stream)은 raw 형식을 그대로 보내므로 언래핑하지 않는다.
      setData(newData.data)
      setLastUpdated(new Date())
      setError(null)
    } catch (err) {
      console.error('실시간 데이터 조회 오류:', err)
      setError(err instanceof Error ? err.message : '데이터 조회에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }, [showRecentActivity])

  // SSE 연결 시도 (가능하면 폴링 대신 사용)
  useEffect(() => {
    let es: EventSource | null = null
    let closed = false

    const tryConnect = () => {
      try {
        es = new EventSource(
          `/api/admin/activities/real-time/stream?include_activity=${showRecentActivity}&limit=20&interval=15000`
        )
        es.addEventListener('update', (ev: MessageEvent) => {
          try {
            const payload = JSON.parse(ev.data)
            setData(payload)
            setLastUpdated(new Date())
            setError(null)
            setLoading(false)
          } catch (e) {
            console.error('SSE parse error:', e)
          }
        })
        es.addEventListener('error', () => {
          // SSE가 종료되면 폴링으로 폴백
          if (!closed) {
            setError(null)
            fetchRealTimeData()
          }
        })
      } catch (e) {
        console.error('SSE init error:', e)
        fetchRealTimeData()
      }
    }

    tryConnect()
    return () => {
      closed = true
      if (es) es.close()
    }
  }, [showRecentActivity, fetchRealTimeData])

  // 자동 새로고침(폴백용 폴링)
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      if (!document.hidden) {
        // 페이지가 보이는 상태에서만 새로고침
        fetchRealTimeData()
      }
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [fetchRealTimeData, refreshInterval, autoRefresh])

  // 페이지 가시성 변경 시 즉시 새로고침
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && autoRefresh) {
        fetchRealTimeData()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [fetchRealTimeData, autoRefresh])

  const handleManualRefresh = () => {
    setLoading(true)
    fetchRealTimeData()
  }

  const getActivityTypeColor = (actionType: string) => {
    switch (actionType) {
      case 'login':
        return 'text-green-600 bg-green-100'
      case 'logout':
        return 'text-gray-600 bg-gray-100'
      case 'post_created':
        return 'text-blue-600 bg-blue-100'
      case 'comment_created':
        return 'text-purple-600 bg-purple-100'
      case 'like_added':
        return 'text-red-600 bg-red-100'
      case 'like_removed':
        return 'text-orange-600 bg-orange-100'
      case 'profile_updated':
        return 'text-indigo-600 bg-indigo-100'
      case 'file_uploaded':
        return 'text-yellow-600 bg-yellow-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  const getActivityTypeLabel = (actionType: string) => {
    const labels: Record<string, string> = {
      login: '로그인',
      logout: '로그아웃',
      post_created: '게시글 작성',
      post_updated: '게시글 수정',
      comment_created: '댓글 작성',
      like_added: '좋아요',
      like_removed: '좋아요 취소',
      profile_updated: '프로필 수정',
      file_uploaded: '파일 업로드',
      page_viewed: '페이지 조회',
      search_performed: '검색',
    }
    return labels[actionType] || actionType
  }

  const formatLastActivity = (lastActivity: string, minutesSince: number) => {
    if (minutesSince < 1) return '방금 전'
    if (minutesSince < 60) return `${Math.floor(minutesSince)}분 전`
    if (minutesSince < 1440) return `${Math.floor(minutesSince / 60)}시간 전`
    return new Date(lastActivity).toLocaleDateString('ko-KR')
  }

  if (loading && !data) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center">
          <div className="text-red-500 mb-2">
            <FiActivity className="w-12 h-12 mx-auto" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">실시간 모니터링 오류</h3>
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <button
            onClick={handleManualRefresh}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <FiRefreshCw className="w-4 h-4 mr-2" />
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      {/* 헤더 및 컨트롤 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
              }`}
            ></div>
            <h2 className="text-lg font-semibold text-gray-900">실시간 활동 모니터링</h2>
          </div>
          {lastUpdated && (
            <span className="text-xs text-gray-500">
              마지막 업데이트: {lastUpdated.toLocaleTimeString('ko-KR')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              autoRefresh
                ? 'bg-green-100 text-green-800 hover:bg-green-200'
                : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
            }`}
          >
            {autoRefresh ? '자동 새로고침 ON' : '자동 새로고침 OFF'}
          </button>

          <button
            onClick={handleManualRefresh}
            disabled={loading}
            className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 disabled:opacity-50 transition-colors"
          >
            <FiRefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiUsers className="w-8 h-8 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">활성 사용자</p>
              <p className="text-2xl font-semibold text-gray-900">{data.statistics.활성사용자수}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiActivity className="w-8 h-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">총 세션</p>
              <p className="text-2xl font-semibold text-gray-900">{data.statistics.총세션수}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiClock className="w-8 h-8 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">평균 세션</p>
              <p className="text-2xl font-semibold text-gray-900">
                {Math.round(data.statistics.평균세션시간)}분
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiTrendingUp className="w-8 h-8 text-orange-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">최고 동시 접속</p>
              <p className="text-2xl font-semibold text-gray-900">
                {Math.max(...Object.values(data.statistics.시간대별세션수), 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 활성 사용자 목록 */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">활성 사용자</h3>
              <span className="text-sm text-gray-500">{data.activeUsers.length}명</span>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {data.activeUsers.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <FiUsers className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                <p>현재 활성 사용자가 없습니다.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {data.activeUsers.map(user => (
                  <div key={user.user_id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {user.display_name}
                        </p>
                        <p className="text-sm text-gray-500 truncate">{user.email}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-400">
                            {formatLastActivity(user.last_activity, user.minutes_since_activity)}
                          </span>
                          <span className="text-xs text-blue-600">
                            오늘 활동 {user.activity_count_today}회
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            user.minutes_since_activity < 5
                              ? 'bg-green-500'
                              : user.minutes_since_activity < 15
                                ? 'bg-yellow-500'
                                : 'bg-gray-400'
                          }`}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 최근 활동 */}
        {showRecentActivity && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">최근 활동</h3>
                <span className="text-sm text-gray-500">{data.recentActivity.length}개</span>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {data.recentActivity.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  <FiBarChart className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                  <p>최근 활동이 없습니다.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {data.recentActivity.map(activity => (
                    <div key={activity.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start gap-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getActivityTypeColor(
                            activity.action_type
                          )}`}
                        >
                          {getActivityTypeLabel(activity.action_type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{activity.user_name}</p>
                          <p className="text-xs text-gray-500 mt-1">{activity.time_ago_text}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default RealTimeActivityMonitor
