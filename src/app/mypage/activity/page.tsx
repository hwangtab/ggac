'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import MypageLayout from '../components/MypageLayout'
import PermissionCheck from '../components/PermissionCheck'
import { FiActivity, FiMessageCircle, FiEdit3, FiUser, FiCalendar, FiFilter } from 'react-icons/fi'

interface Activity {
  id: string
  type: 'post_created' | 'post_updated' | 'comment_created' | 'profile_updated'
  title?: string
  entityId: string
  createdAt: string
  metadata?: {
    category?: string
    postTitle?: string
    postId?: string // 댓글의 경우 게시글 ID
    profileSection?: string
  }
}

interface PaginationInfo {
  currentPage: number
  totalPages: number
  totalCount: number
  hasNext: boolean
}

interface ActivityResponse {
  activities: Activity[]
  pagination: PaginationInfo
}

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [pagination, setPagination] = useState<PaginationInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'posts' | 'comments' | 'profile'>('all')
  const [currentPage, setCurrentPage] = useState(1)

  // API 호출 함수
  const fetchActivities = async (newFilter?: string, pageNum: number = 1, append: boolean = false) => {
    try {
      if (!append) {
        setLoading(true)
        setCurrentPage(1)
      } else {
        setLoadingMore(true)
      }
      setError(null)
      
      const currentFilter = newFilter || filter
      const params = new URLSearchParams({
        filter: currentFilter,
        page: pageNum.toString(),
        limit: '20'
      })

      const response = await fetch(`/api/mypage/activity?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '활동 내역을 불러오는 중 오류가 발생했습니다.')
      }

      const data: ActivityResponse = await response.json()
      
      if (append) {
        setActivities(prev => [...prev, ...data.activities])
        setCurrentPage(pageNum)
      } else {
        setActivities(data.activities)
        setCurrentPage(1)
      }
      setPagination(data.pagination)
    } catch (err) {
      console.error('Activity fetch error:', err)
      setError(err instanceof Error ? err.message : '활동 내역을 불러오는 중 오류가 발생했습니다.')
      if (!append) {
        setActivities([])
        setPagination(null)
      }
    } finally {
      if (!append) {
        setLoading(false)
      } else {
        setLoadingMore(false)
      }
    }
  }

  // 더 많은 활동 내역 로드
  const loadMoreActivities = () => {
    if (pagination && pagination.hasNext && !loadingMore) {
      fetchActivities(filter, currentPage + 1, true)
    }
  }

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    fetchActivities()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 필터 변경 핸들러
  const handleFilterChange = (newFilter: 'all' | 'posts' | 'comments' | 'profile') => {
    setFilter(newFilter)
    setCurrentPage(1)
    fetchActivities(newFilter, 1, false)
  }

  // 활동 링크 생성
  const getActivityLink = (activity: Activity): string | null => {
    switch (activity.type) {
      case 'post_created':
      case 'post_updated':
        return `/board/${activity.entityId}`
      case 'comment_created':
        return activity.metadata?.postId ? `/board/${activity.metadata.postId}` : null
      default:
        return null
    }
  }

  // 활동 링크 클릭 핸들러
  const handleActivityClick = (activity: Activity) => {
    const link = getActivityLink(activity)
    if (link) {
      window.open(link, '_blank')
    }
  }

  const getActivityIcon = (type: Activity['type']) => {
    switch (type) {
      case 'post_created':
      case 'post_updated':
        return <FiEdit3 className="w-4 h-4" />
      case 'comment_created':
        return <FiMessageCircle className="w-4 h-4" />
      case 'profile_updated':
        return <FiUser className="w-4 h-4" />
      default:
        return <FiActivity className="w-4 h-4" />
    }
  }

  const getActivityDescription = (activity: Activity) => {
    switch (activity.type) {
      case 'post_created':
        return `새 게시글을 작성했습니다: "${activity.title}"`
      case 'post_updated':
        return `게시글을 수정했습니다: "${activity.title}"`
      case 'comment_created':
        return `댓글을 작성했습니다: "${activity.metadata?.postTitle}"`
      case 'profile_updated':
        return '프로필 정보를 업데이트했습니다'
      default:
        return '활동이 기록되었습니다'
    }
  }

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return '방금 전'
    if (diffInHours < 24) return `${diffInHours}시간 전`
    
    const diffInDays = Math.floor(diffInHours / 24)
    if (diffInDays < 7) return `${diffInDays}일 전`
    
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const getCategoryBadgeColor = (category?: string) => {
    switch (category) {
      case '공지':
        return 'bg-red-100 text-red-800'
      case '홍보':
        return 'bg-blue-100 text-blue-800'
      case '잡담':
        return 'bg-gray-100 text-gray-800'
      case '건의':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }


  return (
    <PermissionCheck 
      requiredPermission="member"
      redirectTo="/register/pending"
    >
      <MypageLayout title="활동 내역" description="나의 활동 기록을 확인하세요.">
      <div className="max-w-4xl mx-auto">
        {/* 필터 */}
        <div className="mb-6 bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-4">
            <FiFilter className="w-5 h-5 text-gray-600" />
            <div className="flex gap-2">
              <button
                onClick={() => handleFilterChange('all')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                전체
              </button>
              <button
                onClick={() => handleFilterChange('posts')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filter === 'posts'
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                게시글
              </button>
              <button
                onClick={() => handleFilterChange('comments')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filter === 'comments'
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                댓글
              </button>
              <button
                onClick={() => handleFilterChange('profile')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filter === 'profile'
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                프로필
              </button>
            </div>
          </div>
        </div>

        {/* 에러 상태 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
            <div className="flex items-center">
              <FiActivity className="w-5 h-5 text-red-600 mr-3" />
              <div>
                <h3 className="text-red-800 font-semibold">오류가 발생했습니다</h3>
                <p className="text-red-700 text-sm mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => fetchActivities()}
              className="mt-4 btn-secondary text-sm"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* 활동 목록 */}
        <div className="space-y-4">
          {loading ? (
            // 로딩 스켈레톤
            Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="animate-pulse">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                    <div className="flex-1">
                      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : activities.length === 0 ? (
            // 빈 상태
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <FiActivity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                활동 내역이 없습니다
              </h3>
              <p className="text-gray-600 mb-6">
                {filter === 'all' 
                  ? '아직 활동 기록이 없습니다. 게시글을 작성하거나 댓글을 남겨보세요.'
                  : `${filter === 'posts' ? '게시글' : filter === 'comments' ? '댓글' : '프로필'} 관련 활동이 없습니다.`
                }
              </p>
              <div className="flex justify-center gap-3">
                <Link
                  href="/board/write"
                  className="btn-primary"
                >
                  게시글 작성하기
                </Link>
                <Link
                  href="/board"
                  className="btn-secondary"
                >
                  게시판 둘러보기
                </Link>
              </div>
            </div>
          ) : (
            // 활동 카드들
            activities.map((activity) => (
              <div
                key={activity.id}
                className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-4">
                  {/* 아이콘 */}
                  <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center text-primary-600">
                    {getActivityIcon(activity.type)}
                  </div>
                  
                  {/* 내용 */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-gray-900 font-medium mb-1">
                          {getActivityDescription(activity)}
                        </p>
                        <div className="flex items-center gap-3 text-sm text-gray-500">
                          <div className="flex items-center gap-1">
                            <FiCalendar className="w-3 h-3" />
                            {getRelativeTime(activity.createdAt)}
                          </div>
                          {activity.metadata?.category && (
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryBadgeColor(activity.metadata.category)}`}>
                              {activity.metadata.category}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* 링크 버튼 */}
                      {(activity.type.includes('post') || activity.type === 'comment_created') && (
                        <button 
                          onClick={() => handleActivityClick(activity)}
                          className="text-primary-600 hover:text-primary-700 text-sm font-medium transition-colors"
                          disabled={!getActivityLink(activity)}
                        >
                          보기 →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 더 보기 버튼 */}
        {!loading && !error && activities.length > 0 && pagination && pagination.hasNext && (
          <div className="mt-8 text-center">
            <button 
              onClick={loadMoreActivities}
              disabled={loadingMore}
              className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin"></div>
                  로딩중...
                </div>
              ) : (
                `더 많은 활동 내역 보기 (${pagination.totalCount}개 중 ${activities.length}개 표시)`
              )}
            </button>
          </div>
        )}

        {/* 페이지네이션 정보 */}
        {!loading && !error && pagination && activities.length > 0 && (
          <div className="mt-6 text-center text-sm text-gray-500">
            총 {pagination.totalCount}개의 활동 내역이 있습니다.
          </div>
        )}
      </div>
    </MypageLayout>
    </PermissionCheck>
  )
}