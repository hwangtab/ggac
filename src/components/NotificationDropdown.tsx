/**
 * 알림 드롭다운 컴포넌트
 * 헤더에서 사용되는 알림 목록 표시
 */

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { FiBell, FiCheck, FiTrash2, FiX } from 'react-icons/fi'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Notification, NotificationStats } from '@/types'

interface NotificationDropdownProps {
  /** 드롭다운 위치 조정을 위한 클래스 */
  className?: string
  /** 다크 모드 여부 (히어로 섹션 등에서 사용) */
  isDark?: boolean
}

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({ className = '', isDark = false }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [stats, setStats] = useState<NotificationStats | null>(null)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 알림 통계 조회
  const fetchStats = async () => {
    try {
      const response = await fetch('/api/notifications/stats')
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('알림 통계 조회 실패:', error)
    }
  }

  // 알림 목록 조회
  const fetchNotifications = async () => {
    if (loading) return
    
    setLoading(true)
    try {
      const response = await fetch('/api/notifications?limit=10')
      if (response.ok) {
        const data = await response.json()
        setNotifications(data.notifications)
      }
    } catch (error) {
      console.error('알림 조회 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  // 알림 읽음 처리
  const markAsRead = async (notificationId: string) => {
    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'PATCH'
      })
      
      if (response.ok) {
        setNotifications(prev => 
          prev.map(notification => 
            notification.id === notificationId 
              ? { ...notification, read_at: new Date().toISOString() }
              : notification
          )
        )
        await fetchStats() // 통계 업데이트
      }
    } catch (error) {
      console.error('알림 읽음 처리 실패:', error)
    }
  }

  // 알림 삭제
  const deleteNotification = async (notificationId: string) => {
    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setNotifications(prev => prev.filter(n => n.id !== notificationId))
        await fetchStats() // 통계 업데이트
      }
    } catch (error) {
      console.error('알림 삭제 실패:', error)
    }
  }

  // 모든 알림 읽음 처리
  const markAllAsRead = async () => {
    try {
      const response = await fetch('/api/notifications/bulk', {
        method: 'PATCH'
      })
      
      if (response.ok) {
        setNotifications(prev => 
          prev.map(notification => ({
            ...notification,
            read_at: notification.read_at || new Date().toISOString()
          }))
        )
        await fetchStats() // 통계 업데이트
      }
    } catch (error) {
      console.error('모든 알림 읽음 처리 실패:', error)
    }
  }

  // 알림 클릭 핸들러
  const handleNotificationClick = (notification: Notification) => {
    // 읽지 않은 알림인 경우 읽음 처리
    if (!notification.read_at) {
      markAsRead(notification.id)
    }

    // 관련 페이지로 이동
    if (notification.related_post_id) {
      router.push(`/board/${notification.related_post_id}`)
      setIsOpen(false)
    }
  }

  // 드롭다운 토글 핸들러
  const handleToggle = () => {
    if (!isOpen) {
      fetchNotifications()
      fetchStats()
    }
    setIsOpen(!isOpen)
  }

  // 초기 통계 로딩
  useEffect(() => {
    fetchStats()
  }, [])

  // 알림 아이콘 색상 결정
  const getNotificationIconColor = (type: string) => {
    switch (type) {
      case 'post_new':
      case 'post_reply':
        return 'text-blue-600'
      case 'member_approved':
      case 'artist_approved':
        return 'text-green-600'
      case 'member_rejected':
      case 'artist_rejected':
        return 'text-red-600'
      case 'system_notice':
        return 'text-yellow-600'
      default:
        return 'text-gray-600'
    }
  }

  // 시간 포맷팅
  const formatTime = (dateString: string) => {
    return formatDistanceToNow(new Date(dateString), { 
      addSuffix: true, 
      locale: ko 
    })
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* 알림 버튼 */}
      <button
        onClick={handleToggle}
        className={`relative p-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded-lg transition-colors ${
          isDark 
            ? 'text-white hover:text-accent-300' 
            : 'text-gray-600 hover:text-gray-900'
        }`}
        aria-label="알림"
      >
        <FiBell className="w-6 h-6" />
        {stats && stats.unread_count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
            {stats.unread_count > 99 ? '99+' : stats.unread_count}
          </span>
        )}
      </button>

      {/* 드롭다운 메뉴 */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          {/* 헤더 */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h3 className="heading-tertiary">알림</h3>
            <div className="flex items-center space-x-2">
              {stats && stats.unread_count > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center"
                >
                  <FiCheck className="w-4 h-4 mr-1" />
                  모두 읽음
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 알림 목록 */}
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
                <p className="text-sm text-gray-500 mt-2">알림을 불러오는 중...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-4 text-center">
                <FiBell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">새로운 알림이 없습니다.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                      !notification.read_at ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div 
                        className="flex-1 min-w-0"
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <div className="flex items-center mb-1">
                          <div className={`w-2 h-2 rounded-full mr-2 ${
                            !notification.read_at ? 'bg-blue-500' : 'bg-gray-300'
                          }`} />
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {notification.title}
                          </p>
                        </div>
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatTime(notification.created_at)}
                        </p>
                      </div>
                      
                      {/* 액션 버튼들 */}
                      <div className="flex items-center space-x-1 ml-2">
                        {!notification.read_at && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              markAsRead(notification.id)
                            }}
                            className="p-1 text-gray-400 hover:text-green-600 rounded"
                            title="읽음 처리"
                          >
                            <FiCheck className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteNotification(notification.id)
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 rounded"
                          title="삭제"
                        >
                          <FiTrash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 푸터 */}
          {notifications.length > 0 && (
            <div className="p-3 border-t border-gray-200 text-center">
              <button
                onClick={() => {
                  router.push('/notifications')
                  setIsOpen(false)
                }}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                모든 알림 보기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default NotificationDropdown