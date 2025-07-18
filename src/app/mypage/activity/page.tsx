'use client'

import { useState, useEffect } from 'react'
import MypageLayout from '../components/MypageLayout'
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
  }
}

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'posts' | 'comments' | 'profile'>('all')

  // 임시 데이터 (실제 구현 시 API 호출로 대체)
  const mockActivities: Activity[] = [
    {
      id: '1',
      type: 'post_created',
      title: '새로운 프로젝트 공유',
      entityId: 'post-123',
      createdAt: '2024-01-18T10:30:00Z',
      metadata: { category: '홍보' }
    },
    {
      id: '2',
      type: 'comment_created',
      entityId: 'comment-456',
      createdAt: '2024-01-17T15:45:00Z',
      metadata: { postTitle: '협동조합 정기 모임 안내' }
    },
    {
      id: '3',
      type: 'profile_updated',
      entityId: 'profile-789',
      createdAt: '2024-01-16T09:20:00Z'
    },
    {
      id: '4',
      type: 'post_updated',
      title: '공연 일정 변경 안내',
      entityId: 'post-321',
      createdAt: '2024-01-15T14:10:00Z',
      metadata: { category: '공지' }
    }
  ]

  useEffect(() => {
    // 임시로 목 데이터 로드
    setTimeout(() => {
      setActivities(mockActivities)
      setLoading(false)
    }, 1000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const filteredActivities = activities.filter(activity => {
    if (filter === 'all') return true
    if (filter === 'posts') return activity.type.includes('post')
    if (filter === 'comments') return activity.type === 'comment_created'
    if (filter === 'profile') return activity.type === 'profile_updated'
    return true
  })

  return (
    <MypageLayout title="활동 내역" description="나의 활동 기록을 확인하세요.">
      <div className="max-w-4xl mx-auto">
        {/* 필터 */}
        <div className="mb-6 bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-4">
            <FiFilter className="w-5 h-5 text-gray-600" />
            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                전체
              </button>
              <button
                onClick={() => setFilter('posts')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filter === 'posts'
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                게시글
              </button>
              <button
                onClick={() => setFilter('comments')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filter === 'comments'
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                댓글
              </button>
              <button
                onClick={() => setFilter('profile')}
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
          ) : filteredActivities.length === 0 ? (
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
                <a
                  href="/board/write"
                  className="btn-primary"
                >
                  게시글 작성하기
                </a>
                <a
                  href="/board"
                  className="btn-secondary"
                >
                  게시판 둘러보기
                </a>
              </div>
            </div>
          ) : (
            // 활동 카드들
            filteredActivities.map((activity) => (
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
                        <button className="text-primary-600 hover:text-primary-700 text-sm font-medium">
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

        {/* 더 보기 버튼 (향후 페이지네이션용) */}
        {!loading && filteredActivities.length > 0 && (
          <div className="mt-8 text-center">
            <button className="btn-secondary">
              더 많은 활동 내역 보기
            </button>
          </div>
        )}
      </div>
    </MypageLayout>
  )
}