/**
 * 알림 목록 페이지
 * 사용자의 모든 알림을 표시하고 관리할 수 있는 페이지
 */

'use client'

import React, { useState, useEffect, useCallback } from 'react'

// 정적 생성 방지 - 인증이 필요한 동적 페이지
export const dynamic = 'force-dynamic'
import {
  FiBell,
  FiCheck,
  FiTrash2,
  FiFilter,
  FiRefreshCw,
  FiChevronLeft,
  FiChevronRight,
} from 'react-icons/fi'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import type {
  Notification,
  NotificationListResponse,
  NotificationStats,
  NotificationType,
} from '@/types'

const NotificationsPage = () => {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [stats, setStats] = useState<NotificationStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<NotificationType | 'all'>('all')
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set())

  const pageSize = 20
  const router = useRouter()

  // 알림 목록 조회
  const fetchNotifications = useCallback(
    async (page = 1) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: pageSize.toString(),
          ...(filterType !== 'all' && { type: filterType }),
          ...(showUnreadOnly && { unread_only: 'true' }),
        })

        const response = await fetch(`/api/notifications?${params}`)
        if (response.ok) {
          const data: NotificationListResponse = await response.json()
          setNotifications(data.notifications)
          setTotalPages(data.pagination.total_pages)
          setCurrentPage(page)
        }
      } catch (error) {
        console.error('알림 조회 실패:', error)
      } finally {
        setLoading(false)
      }
    },
    [filterType, showUnreadOnly, pageSize]
  )

  // 통계 조회
  const fetchStats = async () => {
    try {
      const response = await fetch('/api/notifications/stats')
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('통계 조회 실패:', error)
    }
  }

  // 알림 읽음 처리
  const markAsRead = async (notificationId: string) => {
    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'PATCH',
      })

      if (response.ok) {
        setNotifications(prev =>
          prev.map(notification =>
            notification.id === notificationId
              ? { ...notification, read_at: new Date().toISOString() }
              : notification
          )
        )
        await fetchStats()
      }
    } catch (error) {
      console.error('알림 읽음 처리 실패:', error)
    }
  }

  // 알림 삭제
  const deleteNotification = async (notificationId: string) => {
    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setNotifications(prev => prev.filter(n => n.id !== notificationId))
        setSelectedNotifications(prev => {
          const newSet = new Set(prev)
          newSet.delete(notificationId)
          return newSet
        })
        await fetchStats()
      }
    } catch (error) {
      console.error('알림 삭제 실패:', error)
    }
  }

  // 모든 알림 읽음 처리
  const markAllAsRead = async () => {
    try {
      const response = await fetch('/api/notifications/bulk', {
        method: 'PATCH',
      })

      if (response.ok) {
        setNotifications(prev =>
          prev.map(notification => ({
            ...notification,
            read_at: notification.read_at || new Date().toISOString(),
          }))
        )
        await fetchStats()
      }
    } catch (error) {
      console.error('모든 알림 읽음 처리 실패:', error)
    }
  }

  // 선택된 알림들 삭제
  const deleteSelected = async () => {
    if (selectedNotifications.size === 0) return

    const deletePromises = Array.from(selectedNotifications).map(id =>
      fetch(`/api/notifications/${id}`, { method: 'DELETE' })
    )

    try {
      await Promise.all(deletePromises)
      setNotifications(prev => prev.filter(n => !selectedNotifications.has(n.id)))
      setSelectedNotifications(new Set())
      await fetchStats()
    } catch (error) {
      console.error('선택된 알림 삭제 실패:', error)
    }
  }

  // 체크박스 토글
  const toggleSelection = (notificationId: string) => {
    setSelectedNotifications(prev => {
      const newSet = new Set(prev)
      if (newSet.has(notificationId)) {
        newSet.delete(notificationId)
      } else {
        newSet.add(notificationId)
      }
      return newSet
    })
  }

  // 전체 선택/해제
  const toggleSelectAll = () => {
    if (selectedNotifications.size === notifications.length) {
      setSelectedNotifications(new Set())
    } else {
      setSelectedNotifications(new Set(notifications.map(n => n.id)))
    }
  }

  // 필터 변경
  const handleFilterChange = (type: NotificationType | 'all') => {
    setFilterType(type)
    setCurrentPage(1)
    setSelectedNotifications(new Set())
  }

  // 미읽음 필터 토글
  const toggleUnreadFilter = () => {
    setShowUnreadOnly(!showUnreadOnly)
    setCurrentPage(1)
    setSelectedNotifications(new Set())
  }

  // 알림 클릭 핸들러 - NotificationDropdown과 동일한 라우팅 로직
  const handleNotificationClick = (notification: Notification) => {
    // 자동으로 읽음 처리
    if (!notification.read_at) {
      markAsRead(notification.id)
    }

    let targetRoute: string | null = null

    // 알림 타입에 따른 라우팅 결정
    switch (notification.type) {
      case 'post_reply':
      case 'post_new':
      case 'post_mention':
        // 게시글 관련 알림 - 해당 게시글로 이동
        const postIdForPost = notification.related_post_id || notification.data?.post_id
        if (postIdForPost) {
          targetRoute = `/board/${postIdForPost}`
        }
        break

      case 'system_notice':
      case 'maintenance':
        // 시스템 공지/점검 알림 - 관련 게시글이 있으면 해당 게시글로, 없으면 현재 페이지 유지
        const postId = notification.related_post_id || notification.data?.post_id
        if (postId) {
          targetRoute = `/board/${postId}`
        }
        break

      case 'member_approved':
      case 'member_rejected':
      case 'artist_approved':
      case 'artist_rejected':
        // 회원/아티스트 권한 관련 알림 - 마이페이지로 이동
        targetRoute = '/mypage'
        break

      case 'welcome':
        // 환영 메시지 - 홈페이지로 이동
        targetRoute = '/'
        break

      default:
        // 기본값: 관련 게시글이 있으면 해당 게시글로
        const defaultPostId = notification.related_post_id || notification.data?.post_id
        if (defaultPostId) {
          targetRoute = `/board/${defaultPostId}`
        }
        break
    }

    // 라우팅 실행
    if (targetRoute) {
      console.log(`Navigating to: ${targetRoute} (type: ${notification.type})`)
      router.push(targetRoute)
    }
  }

  // 초기 로딩
  useEffect(() => {
    fetchNotifications(currentPage)
    fetchStats()
  }, [currentPage, filterType, showUnreadOnly, fetchNotifications])

  // 시간 포맷팅
  const formatTime = (dateString: string) => {
    return formatDistanceToNow(new Date(dateString), {
      addSuffix: true,
      locale: ko,
    })
  }

  // 알림 타입별 색상
  const getTypeColor = (type: NotificationType) => {
    const colors = {
      post_new: 'bg-blue-100 text-blue-800',
      post_reply: 'bg-green-100 text-green-800',
      post_mention: 'bg-purple-100 text-purple-800',
      member_approved: 'bg-green-100 text-green-800',
      member_rejected: 'bg-red-100 text-red-800',
      artist_approved: 'bg-emerald-100 text-emerald-800',
      artist_rejected: 'bg-red-100 text-red-800',
      system_notice: 'bg-yellow-100 text-yellow-800',
      maintenance: 'bg-orange-100 text-orange-800',
      welcome: 'bg-pink-100 text-pink-800',
    }
    return colors[type] || 'bg-gray-100 text-gray-800'
  }

  // 알림 타입별 한글 이름
  const getTypeName = (type: NotificationType) => {
    const names = {
      post_new: '새 게시글',
      post_reply: '댓글',
      post_mention: '멘션',
      member_approved: '회원 승인',
      member_rejected: '회원 거부',
      artist_approved: '아티스트 승인',
      artist_rejected: '아티스트 거부',
      system_notice: '시스템 공지',
      maintenance: '점검',
      welcome: '환영',
    }
    return names[type] || type
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 헤더 */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <FiBell className="w-8 h-8 text-primary-600 mr-3" />
              <div>
                <h1 className="tw-heading-secondary">알림</h1>
                {stats && (
                  <p className="text-sm text-gray-600">
                    전체 {stats.total_notifications}개 | 미읽음 {stats.unread_count}개
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => fetchNotifications(currentPage)}
                className="flex items-center px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <FiRefreshCw className="w-4 h-4 mr-1" />
                새로고침
              </button>

              {stats && stats.unread_count > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center px-3 py-2 text-sm text-white bg-primary-600 hover:bg-primary-700 rounded-lg"
                >
                  <FiCheck className="w-4 h-4 mr-1" />
                  모두 읽음
                </button>
              )}
            </div>
          </div>

          {/* 필터 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <FiFilter className="w-4 h-4 text-gray-500 mr-2" />
                <select
                  value={filterType}
                  onChange={e => handleFilterChange(e.target.value as NotificationType | 'all')}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1"
                >
                  <option value="all">모든 유형</option>
                  <option value="post_new">새 게시글</option>
                  <option value="post_reply">댓글</option>
                  <option value="member_approved">회원 승인</option>
                  <option value="artist_approved">아티스트 승인</option>
                  <option value="system_notice">시스템 공지</option>
                </select>
              </div>

              <label className="flex items-center text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={showUnreadOnly}
                  onChange={toggleUnreadFilter}
                  className="mr-2 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                미읽음만 보기
              </label>
            </div>

            {selectedNotifications.size > 0 && (
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">{selectedNotifications.size}개 선택됨</span>
                <button
                  onClick={deleteSelected}
                  className="flex items-center px-3 py-1 text-sm text-red-600 hover:text-red-700 border border-red-300 rounded-lg hover:bg-red-50"
                >
                  <FiTrash2 className="w-4 h-4 mr-1" />
                  삭제
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 알림 목록 */}
        <div className="bg-white rounded-lg shadow-sm">
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
              <p className="text-gray-600">알림을 불러오는 중...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center">
              <FiBell className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">
                {showUnreadOnly ? '새로운 알림이 없습니다.' : '알림이 없습니다.'}
              </p>
            </div>
          ) : (
            <>
              {/* 목록 헤더 */}
              <div className="p-4 border-b border-gray-200 flex items-center">
                <input
                  type="checkbox"
                  checked={selectedNotifications.size === notifications.length}
                  onChange={toggleSelectAll}
                  className="mr-3 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-600">전체 선택</span>
              </div>

              {/* 목록 */}
              <ul className="divide-y divide-gray-200">
                {notifications.map(notification => (
                  <li
                    key={notification.id}
                    className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                      !notification.read_at ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start">
                      <input
                        type="checkbox"
                        checked={selectedNotifications.has(notification.id)}
                        onChange={() => toggleSelection(notification.id)}
                        onClick={e => e.stopPropagation()}
                        className="mt-1 mr-3 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center">
                            <span
                              className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getTypeColor(notification.type)}`}
                            >
                              {getTypeName(notification.type)}
                            </span>
                            {!notification.read_at && (
                              <span className="ml-2 w-2 h-2 bg-blue-500 rounded-full" />
                            )}
                          </div>
                          <span className="text-xs text-gray-400">
                            {formatTime(notification.created_at)}
                          </span>
                        </div>

                        <h3 className="text-sm font-medium text-gray-900 mb-1">
                          {notification.title}
                        </h3>
                        <p className="text-sm text-gray-600 mb-2">{notification.message}</p>
                      </div>

                      <div className="flex items-center space-x-1 ml-4">
                        {!notification.read_at && (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              markAsRead(notification.id)
                            }}
                            className="p-2 text-gray-400 hover:text-green-600 rounded-lg hover:bg-green-50"
                            title="읽음 처리"
                          >
                            <FiCheck className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            deleteNotification(notification.id)
                          }}
                          className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                          title="삭제"
                        >
                          <FiTrash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="p-4 border-t border-gray-200 flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {currentPage} / {totalPages} 페이지
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="flex items-center px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FiChevronLeft className="w-4 h-4 mr-1" />
                      이전
                    </button>
                    <button
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="flex items-center px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      다음
                      <FiChevronRight className="w-4 h-4 ml-1" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default NotificationsPage
