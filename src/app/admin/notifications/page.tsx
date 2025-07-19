/**
 * 관리자 알림 관리 페이지
 * 대량 알림 발송 및 알림 템플릿 관리
 */

'use client'

import React, { useState, useEffect } from 'react'
import { FiBell, FiSend, FiUsers, FiEdit3, FiTrash2, FiPlus } from 'react-icons/fi'
import type { CreateBulkNotificationRequest, NotificationType } from '@/types'

interface MemberProfile {
  id: string
  email: string
  name: string
  registration_status: 'pending' | 'approved' | 'rejected'
  is_artist: boolean
  is_admin: boolean
}

interface NotificationTemplate {
  id: string
  name: string
  type: NotificationType
  title: string
  message: string
  target_audience: 'all' | 'artists' | 'members' | 'admins'
}

const AdminNotificationsPage = () => {
  const [activeTab, setActiveTab] = useState<'send' | 'templates'>('send')
  const [members, setMembers] = useState<MemberProfile[]>([])
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set())
  const [templates, setTemplates] = useState<NotificationTemplate[]>([])
  const [loading, setLoading] = useState(false)
  
  // 알림 발송 폼 상태
  const [notificationForm, setNotificationForm] = useState({
    type: 'system_notice' as NotificationType,
    title: '',
    message: '',
    audience: 'all' as 'all' | 'approved' | 'artists' | 'admins' | 'custom',
    expires_hours: 24
  })

  // 템플릿 폼 상태
  const [templateForm, setTemplateForm] = useState({
    name: '',
    type: 'system_notice' as NotificationType,
    title: '',
    message: '',
    target_audience: 'all' as 'all' | 'artists' | 'members' | 'admins'
  })

  // 멤버 목록 조회
  const fetchMembers = async () => {
    try {
      const response = await fetch('/api/admin/members')
      if (response.ok) {
        const data = await response.json()
        setMembers(data.members)
      }
    } catch (error) {
      console.error('멤버 목록 조회 실패:', error)
    }
  }

  // 대상자 자동 선택
  const selectAudience = (audience: string) => {
    let targetMembers: string[] = []
    
    switch (audience) {
      case 'all':
        targetMembers = members.map(m => m.id)
        break
      case 'approved':
        targetMembers = members.filter(m => m.registration_status === 'approved').map(m => m.id)
        break
      case 'artists':
        targetMembers = members.filter(m => m.is_artist && m.registration_status === 'approved').map(m => m.id)
        break
      case 'admins':
        targetMembers = members.filter(m => m.is_admin).map(m => m.id)
        break
      default:
        return
    }
    
    setSelectedMembers(new Set(targetMembers))
  }

  // 대량 알림 발송
  const sendBulkNotification = async () => {
    if (selectedMembers.size === 0) {
      alert('알림을 받을 사용자를 선택해주세요.')
      return
    }

    if (!notificationForm.title.trim() || !notificationForm.message.trim()) {
      alert('제목과 메시지를 입력해주세요.')
      return
    }

    setLoading(true)
    try {
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + notificationForm.expires_hours)

      const requestData: CreateBulkNotificationRequest = {
        user_ids: Array.from(selectedMembers),
        type: notificationForm.type,
        title: notificationForm.title,
        message: notificationForm.message,
        expires_at: expiresAt.toISOString()
      }

      const response = await fetch('/api/notifications/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      })

      if (response.ok) {
        const result = await response.json()
        alert(`${result.created_count}개의 알림이 성공적으로 발송되었습니다.`)
        
        // 폼 초기화
        setNotificationForm({
          type: 'system_notice',
          title: '',
          message: '',
          audience: 'all',
          expires_hours: 24
        })
        setSelectedMembers(new Set())
      } else {
        const error = await response.json()
        alert(`알림 발송 실패: ${error.error}`)
      }
    } catch (error) {
      console.error('알림 발송 실패:', error)
      alert('알림 발송 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 멤버 선택 토글
  const toggleMember = (memberId: string) => {
    setSelectedMembers(prev => {
      const newSet = new Set(prev)
      if (newSet.has(memberId)) {
        newSet.delete(memberId)
      } else {
        newSet.add(memberId)
      }
      return newSet
    })
  }

  // 전체 선택/해제
  const toggleSelectAll = () => {
    if (selectedMembers.size === members.length) {
      setSelectedMembers(new Set())
    } else {
      setSelectedMembers(new Set(members.map(m => m.id)))
    }
  }

  // 대상자 변경 시 자동 선택
  useEffect(() => {
    if (notificationForm.audience !== 'custom') {
      selectAudience(notificationForm.audience)
    }
  }, [notificationForm.audience, members])

  // 초기 데이터 로딩
  useEffect(() => {
    fetchMembers()
  }, [])

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
      welcome: '환영'
    }
    return names[type] || type
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 헤더 */}
      <div className="mb-8">
        <div className="flex items-center mb-4">
          <FiBell className="w-8 h-8 text-primary-600 mr-3" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">알림 관리</h1>
            <p className="text-gray-600">멤버들에게 알림을 발송하고 관리합니다.</p>
          </div>
        </div>

        {/* 탭 */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('send')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'send'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              알림 발송
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'templates'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              템플릿 관리
            </button>
          </nav>
        </div>
      </div>

      {activeTab === 'send' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 알림 발송 폼 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">알림 발송</h3>
            
            {/* 알림 유형 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                알림 유형
              </label>
              <select
                value={notificationForm.type}
                onChange={(e) => setNotificationForm(prev => ({ 
                  ...prev, 
                  type: e.target.value as NotificationType 
                }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="system_notice">시스템 공지</option>
                <option value="maintenance">점검 안내</option>
                <option value="welcome">환영 메시지</option>
                <option value="post_new">새 게시글</option>
              </select>
            </div>

            {/* 대상자 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                대상자
              </label>
              <select
                value={notificationForm.audience}
                onChange={(e) => setNotificationForm(prev => ({ 
                  ...prev, 
                  audience: e.target.value as any 
                }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="all">전체 사용자</option>
                <option value="approved">승인된 멤버</option>
                <option value="artists">아티스트</option>
                <option value="admins">관리자</option>
                <option value="custom">직접 선택</option>
              </select>
            </div>

            {/* 제목 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                제목
              </label>
              <input
                type="text"
                value={notificationForm.title}
                onChange={(e) => setNotificationForm(prev => ({ 
                  ...prev, 
                  title: e.target.value 
                }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="알림 제목을 입력하세요"
                maxLength={200}
              />
            </div>

            {/* 메시지 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                메시지
              </label>
              <textarea
                value={notificationForm.message}
                onChange={(e) => setNotificationForm(prev => ({ 
                  ...prev, 
                  message: e.target.value 
                }))}
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="알림 내용을 입력하세요"
                maxLength={1000}
              />
            </div>

            {/* 만료 시간 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                만료 시간 (시간)
              </label>
              <select
                value={notificationForm.expires_hours}
                onChange={(e) => setNotificationForm(prev => ({ 
                  ...prev, 
                  expires_hours: parseInt(e.target.value) 
                }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value={1}>1시간</option>
                <option value={6}>6시간</option>
                <option value={24}>1일</option>
                <option value={72}>3일</option>
                <option value={168}>1주일</option>
              </select>
            </div>

            {/* 발송 버튼 */}
            <button
              onClick={sendBulkNotification}
              disabled={loading || selectedMembers.size === 0}
              className="w-full flex items-center justify-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
              ) : (
                <FiSend className="w-5 h-5 mr-2" />
              )}
              {selectedMembers.size}명에게 알림 발송
            </button>
          </div>

          {/* 대상자 목록 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                대상자 목록 ({selectedMembers.size}/{members.length})
              </h3>
              <button
                onClick={toggleSelectAll}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                {selectedMembers.size === members.length ? '전체 해제' : '전체 선택'}
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
              {members.map((member) => (
                <div
                  key={member.id}
                  className={`p-3 border-b border-gray-200 last:border-b-0 ${
                    selectedMembers.has(member.id) ? 'bg-primary-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedMembers.has(member.id)}
                      onChange={() => toggleMember(member.id)}
                      className="mr-3 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900">
                          {member.name || member.email}
                        </span>
                        <div className="flex items-center space-x-2">
                          {member.is_admin && (
                            <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">
                              관리자
                            </span>
                          )}
                          {member.is_artist && (
                            <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded-full">
                              아티스트
                            </span>
                          )}
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            member.registration_status === 'approved'
                              ? 'bg-green-100 text-green-800'
                              : member.registration_status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {member.registration_status === 'approved' ? '승인' :
                             member.registration_status === 'pending' ? '대기' : '거부'}
                          </span>
                        </div>
                      </div>
                      <span className="text-sm text-gray-600">{member.email}</span>
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">알림 템플릿</h3>
            <button
              className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <FiPlus className="w-4 h-4 mr-2" />
              새 템플릿
            </button>
          </div>

          <div className="text-center py-12 text-gray-500">
            <FiBell className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>알림 템플릿 기능은 곧 추가될 예정입니다.</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminNotificationsPage