'use client'

import { FiUser, FiUserPlus, FiEye, FiX, FiMusic, FiExternalLink } from 'react-icons/fi'
import OptimizedImage from '@/components/OptimizedImage'

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

interface ArtistCardProps {
  artist: Artist
  onAssign: () => void
  onRemoveAssignment: (artistId: string, memberId: string) => void
  isLoading: boolean
}

export default function ArtistCard({ artist, onAssign, onRemoveAssignment, isLoading }: ArtistCardProps) {
  const getArtistProfileUrl = (slug: string) => {
    return `/artists/${slug}`
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

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-purple-100 text-purple-800'
      case 'manager':
        return 'bg-blue-100 text-blue-800'
      case 'collaborator':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatCategory = (category: string | string[]) => {
    if (Array.isArray(category)) {
      return category.join(', ')
    }
    return category
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
      {/* 아티스트 기본 정보 */}
      <div className="p-4">
        <div className="flex items-start space-x-4">
          {/* 프로필 이미지 */}
          <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
            {artist.profileImage ? (
              <OptimizedImage
                src={artist.profileImage}
                alt={artist.name}
                width={64}
                height={64}
                className="w-full h-full object-cover"
                fallbackText={artist.name.slice(0, 2)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <FiMusic className="w-6 h-6 text-gray-400" />
              </div>
            )}
          </div>

          {/* 아티스트 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 truncate">
                  {artist.name}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {formatCategory(artist.category)}
                </p>
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                  {artist.oneLiner}
                </p>
              </div>
              
              {/* 액션 버튼 */}
              <div className="flex items-center space-x-2 ml-4">
                <a
                  href={getArtistProfileUrl(artist.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                  title="프로필 보기"
                >
                  <FiExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={onAssign}
                  disabled={isLoading}
                  className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
                  title="아티스트 배정"
                >
                  <FiUserPlus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 배정된 멤버 목록 */}
      {artist.assignedMembers && artist.assignedMembers.length > 0 && (
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <h4 className="text-sm font-medium text-gray-900 mb-2">배정된 멤버</h4>
          <div className="space-y-2">
            {artist.assignedMembers.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-2 bg-white rounded border"
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
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleColor(member.artist_role)}`}>
                    {getRoleText(member.artist_role)}
                  </span>
                  <button
                    onClick={() => onRemoveAssignment(artist.id, member.id)}
                    disabled={isLoading}
                    className="p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                    title="배정 해제"
                  >
                    <FiX className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 로딩 상태 */}
      {isLoading && (
        <div className="border-t border-gray-200 p-2 bg-gray-50">
          <div className="flex items-center text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mr-2"></div>
            처리 중...
          </div>
        </div>
      )}
    </div>
  )
}