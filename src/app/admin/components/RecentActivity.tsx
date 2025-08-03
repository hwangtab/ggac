'use client'

import { useState, useEffect, useCallback } from 'react'
import { FiUser, FiEdit3, FiMusic, FiClock, FiChevronRight, FiRefreshCw } from 'react-icons/fi'

interface ActivityItem {
  id: string
  type: 'member_registered' | 'member_approved' | 'post_created' | 'artist_updated'
  title: string
  description: string
  timestamp: string
  user?: {
    name: string
  }
  status?: string
  category?: string
  is_pinned?: boolean
}

interface PaginationInfo {
  currentPage: number
  totalPages: number
  totalCount: number
  hasNext: boolean
}

interface ActivityResponse {
  activities: ActivityItem[]
  pagination: PaginationInfo
  metadata: {
    days: number
    limit: number
    generatedAt: string
  }
}

const RecentActivity: React.FC = () => {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pagination, setPagination] = useState<PaginationInfo | null>(null)
  const [days, setDays] = useState(7)
  const [limit, setLimit] = useState(10)

  useEffect(() => {
    fetchRecentActivity()
  }, [fetchRecentActivity])

  const fetchRecentActivity = useCallback(async (page = 1) => {
    try {
      setRefreshing(true)
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        days: days.toString()
      })
      
      const response = await fetch(`/api/admin/activity?${params}`)
      if (response.ok) {
        const data: ActivityResponse = await response.json()
        setActivities(data.activities || [])
        setPagination(data.pagination)
      } else {
        console.error('Failed to fetch activities:', response.status)
      }
    } catch (error) {
      console.error('Failed to fetch recent activity:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [days, limit])

  const handleRefresh = () => {
    fetchRecentActivity(pagination?.currentPage || 1)
  }

  const handleLoadMore = () => {
    if (pagination?.hasNext) {
      fetchRecentActivity(pagination.currentPage + 1)
    }
  }

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'member_registered':
      case 'member_approved':
        return <FiUser className="w-4 h-4" />
      case 'post_created':
        return <FiEdit3 className="w-4 h-4" />
      case 'artist_updated':
        return <FiMusic className="w-4 h-4" />
      default:
        return <FiClock className="w-4 h-4" />
    }
  }

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'member_registered':
        return 'bg-blue-100 text-blue-600'
      case 'member_approved':
        return 'bg-green-100 text-green-600'
      case 'post_created':
        return 'bg-purple-100 text-purple-600'
      case 'artist_updated':
        return 'bg-yellow-100 text-yellow-600'
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  const getRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return '방금 전'
    if (diffInHours < 24) return `${diffInHours}시간 전`
    
    const diffInDays = Math.floor(diffInHours / 24)
    if (diffInDays < 7) return `${diffInDays}일 전`
    
    return date.toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8">
        <FiClock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-500">최근 활동이 없습니다.</p>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="mt-4 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
        >
          새로고침
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 컨트롤 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value={1}>최근 1일</option>
            <option value={7}>최근 7일</option>
            <option value={14}>최근 14일</option>
            <option value={30}>최근 30일</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value))}
            className="text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value={10}>10개씩</option>
            <option value={20}>20개씩</option>
            <option value={50}>50개씩</option>
          </select>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
        >
          <FiRefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </div>

      {/* 활동 목록 */}
      <div className="space-y-4">
        {activities.map((activity) => (
          <div key={activity.id} className="flex items-start gap-4 p-3 rounded-lg hover:bg-gray-50">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getActivityColor(activity.type)}`}>
              {getActivityIcon(activity.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900">{activity.title}</p>
                {activity.is_pinned && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">
                    고정
                  </span>
                )}
                {activity.status && (
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${
                    activity.status === 'approved' ? 'bg-green-100 text-green-800' :
                    activity.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {activity.status === 'approved' ? '승인됨' : 
                     activity.status === 'pending' ? '대기중' : activity.status}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">{activity.description}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-gray-400">{getRelativeTime(activity.timestamp)}</p>
                {activity.category && (
                  <span className="text-xs text-gray-400">• {activity.category}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 페이지네이션 정보 및 더 보기 */}
      {pagination && (
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-sm text-gray-500">
            총 {pagination.totalCount}개 중 {activities.length}개 표시
          </p>
          {pagination.hasNext && (
            <button
              onClick={handleLoadMore}
              disabled={refreshing}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
            >
              더 보기
              <FiChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default RecentActivity