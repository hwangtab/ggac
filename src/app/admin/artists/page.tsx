'use client'

import { useState, useEffect } from 'react'
import { FiMusic, FiUsers, FiSearch, FiFilter, FiRefreshCw, FiPlus, FiEdit3, FiEye, FiUserCheck, FiUserX } from 'react-icons/fi'
import AdminLayout from '../components/AdminLayout'
import ArtistCard from './components/ArtistCard'
import AssignArtistModal from './components/AssignArtistModal'

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

export default function ArtistsPage() {
  const [artists, setArtists] = useState<Artist[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState<'all' | 'assigned' | 'unassigned'>('all')
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const [artistsResponse, membersResponse] = await Promise.all([
        fetch('/api/admin/artists'),
        fetch('/api/admin/artists/members')
      ])

      if (!artistsResponse.ok || !membersResponse.ok) {
        throw new Error('데이터를 불러오는 중 오류가 발생했습니다.')
      }

      const artistsData = await artistsResponse.json()
      const membersData = await membersResponse.json()

      setArtists(artistsData.artists)
      setMembers(membersData.members)
    } catch (err) {
      console.error('Data fetch error:', err)
      setError(err instanceof Error ? err.message : '데이터를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleAssignArtist = (artist: Artist) => {
    setSelectedArtist(artist)
    setIsModalOpen(true)
  }

  const handleRemoveAssignment = async (artistId: string, memberId: string) => {
    try {
      setActionLoading(`${artistId}-${memberId}`)
      
      const response = await fetch(`/api/admin/artists/${artistId}/members/${memberId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '아티스트 권한 제거에 실패했습니다.')
      }

      // 데이터 새로고침
      await fetchData()
    } catch (err) {
      console.error('Remove assignment error:', err)
      alert(err instanceof Error ? err.message : '아티스트 권한 제거에 실패했습니다.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleAssignmentSuccess = () => {
    setIsModalOpen(false)
    setSelectedArtist(null)
    fetchData()
  }

  const filteredArtists = artists.filter(artist => {
    const matchesSearch = artist.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         artist.oneLiner.toLowerCase().includes(searchTerm.toLowerCase())
    
    if (filter === 'all') return matchesSearch
    
    const hasAssignedMembers = artist.assignedMembers && artist.assignedMembers.length > 0
    
    if (filter === 'assigned') return matchesSearch && hasAssignedMembers
    if (filter === 'unassigned') return matchesSearch && !hasAssignedMembers
    
    return matchesSearch
  })

  const assignedArtistsCount = artists.filter(a => a.assignedMembers && a.assignedMembers.length > 0).length
  const unassignedArtistsCount = artists.length - assignedArtistsCount
  const totalMembers = members.filter(m => m.is_artist).length

  return (
    <AdminLayout title="아티스트 관리" description="아티스트 권한 부여 및 프로필 관리">
      <div className="space-y-6">
        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">전체 아티스트</p>
                <p className="text-2xl font-bold text-gray-900">{artists.length}</p>
              </div>
              <FiMusic className="w-8 h-8 text-purple-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">배정된 아티스트</p>
                <p className="text-2xl font-bold text-green-600">{assignedArtistsCount}</p>
              </div>
              <FiUserCheck className="w-8 h-8 text-green-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">미배정 아티스트</p>
                <p className="text-2xl font-bold text-orange-600">{unassignedArtistsCount}</p>
              </div>
              <FiUserX className="w-8 h-8 text-orange-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">아티스트 권한 회원</p>
                <p className="text-2xl font-bold text-blue-600">{totalMembers}</p>
              </div>
              <FiUsers className="w-8 h-8 text-blue-500" />
            </div>
          </div>
        </div>

        {/* 검색 및 필터 */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex items-center gap-2 flex-1">
              <FiSearch className="w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="아티스트명, 소개로 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <FiFilter className="w-5 h-5 text-gray-400" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">전체</option>
                <option value="assigned">배정됨</option>
                <option value="unassigned">미배정</option>
              </select>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              <FiRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 아티스트 목록 */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">아티스트 목록</h2>
            <p className="text-sm text-gray-600 mt-1">
              총 {filteredArtists.length}명의 아티스트가 있습니다.
            </p>
          </div>
          
          <div className="p-6">
            {loading ? (
              <div className="space-y-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-gray-200 rounded-lg"></div>
                        <div>
                          <div className="h-4 bg-gray-200 rounded w-24 mb-2"></div>
                          <div className="h-3 bg-gray-200 rounded w-32"></div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-6 bg-gray-200 rounded"></div>
                        <div className="w-8 h-8 bg-gray-200 rounded"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <p className="text-red-600 mb-4">{error}</p>
                <button
                  onClick={fetchData}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
                >
                  다시 시도
                </button>
              </div>
            ) : filteredArtists.length === 0 ? (
              <div className="text-center py-8">
                <FiMusic className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchTerm ? '검색 결과가 없습니다.' : '아티스트가 없습니다.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filteredArtists.map((artist) => (
                  <ArtistCard
                    key={artist.id}
                    artist={artist}
                    onAssign={() => handleAssignArtist(artist)}
                    onRemoveAssignment={handleRemoveAssignment}
                    isLoading={actionLoading?.startsWith(artist.id) || false}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 아티스트 배정 모달 */}
      {selectedArtist && (
        <AssignArtistModal
          artist={selectedArtist}
          members={members}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={handleAssignmentSuccess}
        />
      )}
    </AdminLayout>
  )
}