'use client'

import { useState } from 'react'
import { FiX, FiUser, FiUserPlus, FiCheck } from 'react-icons/fi'
import Image from 'next/image'

interface Artist {
  id: string
  name: string
  category: string | string[]
  profileImage: string
  oneLiner: string
  bio: string
  contact: string
  slug: string
  templateType: string
  portfolioLinks: Array<{ title: string; url: string }> | null
  youtubeVideos: Array<{ title?: string; url: string }> | null
  assignedMembers?: Array<{
    id: string
    display_name: string
    email: string
    artist_role: 'owner' | 'manager' | 'collaborator'
  }>
}

interface Member {
  id: string
  display_name: string
  email: string
  is_artist: boolean
  artist_id?: string
  artist_role?: 'owner' | 'manager' | 'collaborator'
}

interface AssignArtistModalProps {
  artist: Artist
  members: Member[]
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function AssignArtistModal({ artist, members, isOpen, onClose, onSuccess }: AssignArtistModalProps) {
  const [selectedMember, setSelectedMember] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<'owner' | 'manager' | 'collaborator'>('collaborator')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  if (!isOpen) return null

  // 현재 아티스트에 이미 배정된 멤버들의 ID 목록
  const assignedMemberIds = artist.assignedMembers?.map(m => m.id) || []

  // 검색 가능한 멤버들 (승인된 멤버 중에서 현재 아티스트에 배정되지 않은 멤버)
  const availableMembers = members.filter(member => 
    member.email && 
    !assignedMemberIds.includes(member.id) &&
    (member.display_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
     member.email.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedMember || !selectedRole) {
      alert('멤버와 역할을 선택해주세요.')
      return
    }

    try {
      setIsSubmitting(true)
      
      const response = await fetch(`/api/admin/artists/${artist.id}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: selectedMember,
          role: selectedRole
        })
      })

      console.log('Response status:', response.status)
      console.log('Response headers:', response.headers)

      if (!response.ok) {
        // 응답이 비어있는지 확인
        const responseText = await response.text()
        console.log('Response text:', responseText)
        
        if (!responseText.trim()) {
          throw new Error(`서버 오류 (${response.status}): 빈 응답을 받았습니다.`)
        }

        try {
          const errorData = JSON.parse(responseText)
          throw new Error(errorData.error || `서버 오류 (${response.status})`)
        } catch (parseError) {
          console.error('JSON parse error:', parseError)
          throw new Error(`서버 오류 (${response.status}): ${responseText.substring(0, 100)}`)
        }
      }

      // 성공 응답도 동일하게 처리
      const responseText = await response.text()
      if (!responseText.trim()) {
        throw new Error('서버에서 빈 응답을 받았습니다.')
      }

      try {
        const result = JSON.parse(responseText)
        if (!result.success) {
          throw new Error(result.error || '아티스트 배정에 실패했습니다.')
        }
      } catch (parseError) {
        console.error('Success response parse error:', parseError)
        // 성공적인 상태 코드이지만 JSON이 아닌 경우는 성공으로 처리
        console.log('Treating as success despite parse error')
      }

      onSuccess()
      resetForm()
    } catch (error) {
      console.error('Assignment error:', error)
      alert(error instanceof Error ? error.message : '아티스트 배정에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setSelectedMember('')
    setSelectedRole('collaborator')
    setSearchTerm('')
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const getRoleText = (role: string) => {
    switch (role) {
      case 'owner':
        return '대표'
      case 'manager':
        return '매니저'
      case 'collaborator':
        return '협력자'
      default:
        return role
    }
  }

  const formatCategory = (category: string | string[]) => {
    if (Array.isArray(category)) {
      return category.join(', ')
    }
    return category
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">아티스트 배정</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-md transition-colors"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        {/* 아티스트 정보 */}
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
              {artist.profileImage ? (
                <Image
                  src={artist.profileImage}
                  alt={artist.name}
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <FiUser className="w-6 h-6 text-gray-400" />
                </div>
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{artist.name}</h3>
              <p className="text-sm text-gray-600">{formatCategory(artist.category)}</p>
              <p className="text-sm text-gray-500 mt-1">{artist.oneLiner}</p>
            </div>
          </div>
        </div>

        {/* 폼 콘텐츠 */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto">
          <div className="space-y-6">
            {/* 멤버 검색 */}
            <div>
              <label htmlFor="member-search" className="block text-sm font-medium text-gray-700 mb-2">
                멤버 검색
              </label>
              <input
                id="member-search"
                type="text"
                placeholder="멤버명이나 이메일로 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* 멤버 선택 */}
            <div>
              <label htmlFor="member-select" className="block text-sm font-medium text-gray-700 mb-2">
                멤버 선택
              </label>
              <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-md">
                {availableMembers.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    {searchTerm ? '검색 결과가 없습니다.' : '배정 가능한 멤버가 없습니다.'}
                  </div>
                ) : (
                  <div className="space-y-1 p-2">
                    {availableMembers.map((member) => (
                      <label
                        key={member.id}
                        className={`flex items-center p-3 rounded-md cursor-pointer transition-colors ${
                          selectedMember === member.id
                            ? 'bg-primary-50 border-primary-200'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="member"
                          value={member.id}
                          checked={selectedMember === member.id}
                          onChange={(e) => setSelectedMember(e.target.value)}
                          className="mr-3"
                        />
                        <div className="flex items-center space-x-3 flex-1">
                          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                            <FiUser className="w-4 h-4 text-gray-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {member.display_name}
                            </p>
                            <p className="text-xs text-gray-500">{member.email}</p>
                          </div>
                        </div>
                        {selectedMember === member.id && (
                          <FiCheck className="w-4 h-4 text-primary-600" />
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 역할 선택 */}
            <div>
              <label htmlFor="role-select" className="block text-sm font-medium text-gray-700 mb-2">
                역할 선택
              </label>
              <select
                id="role-select"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as 'owner' | 'manager' | 'collaborator')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="collaborator">협력자</option>
                <option value="manager">매니저</option>
                <option value="owner">대표</option>
              </select>
              <p className="mt-1 text-sm text-gray-500">
                {selectedRole === 'owner' && '아티스트 프로필을 완전히 관리할 수 있습니다.'}
                {selectedRole === 'manager' && '아티스트 프로필을 편집할 수 있습니다.'}
                {selectedRole === 'collaborator' && '아티스트 프로필을 조회할 수 있습니다.'}
              </p>
            </div>

            {/* 현재 배정된 멤버들 */}
            {artist.assignedMembers && artist.assignedMembers.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">현재 배정된 멤버</h4>
                <div className="space-y-2">
                  {artist.assignedMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded border"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                          <FiUser className="w-4 h-4 text-gray-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {member.display_name}
                          </p>
                          <p className="text-xs text-gray-500">{member.email}</p>
                        </div>
                      </div>
                      <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                        {getRoleText(member.artist_role)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </form>

        {/* 액션 버튼 */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedMember}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 flex items-center"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                배정 중...
              </>
            ) : (
              <>
                <FiUserPlus className="w-4 h-4 mr-2" />
                배정하기
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}