'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FiUsers,
  FiBriefcase,
  FiCheck,
  FiX,
  FiEye,
  FiSearch,
  FiFilter,
  FiRefreshCw,
  FiBarChart,
  FiPackage,
  FiShield,
  FiAlertCircle,
  FiPause,
  FiSettings,
} from 'react-icons/fi'
import AdminLayout from '../components/AdminLayout'
import MemberCard from './components/MemberCard'
import MemberDetailModal from './components/MemberDetailModal'
import AdvancedFilterBuilder from '@/components/AdvancedFilterBuilder'
import type {
  AdvancedSearchQuery,
  FilteredResult,
  FieldDefinition,
  MemberStatistics,
} from '@/types'

interface Member {
  id: string
  display_name: string
  email: string
  phone_number?: string
  real_name?: string
  created_at: string
  updated_at: string
  registration_status: 'pending' | 'approved' | 'rejected'
  is_active: boolean
  is_admin: boolean
  is_director: boolean
  director_title?: string | null
  is_auditor: boolean
  is_artist: boolean
  artist_id?: string
  monthly_fee?: number
  bank_name?: string
  account_number?: string
  account_holder?: string
  // 새로운 멤버 상태 관리 필드들
  last_login_at?: string
  is_suspended: boolean
  suspension_reason?: string
  suspension_until?: string
  profile_completeness_score: number
  verification_status: {
    email: boolean
    phone: boolean
    identity: boolean
  }
  membership_type: 'regular' | 'premium' | 'lifetime'
  engagement_score: number
  approved_by?: string
  rejected_by?: string
}

interface MembersResponse {
  members: Member[]
  pagination: {
    currentPage: number
    totalPages: number
    totalCount: number
    hasNext: boolean
  }
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set())
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [showBulkActions, setShowBulkActions] = useState(false)
  const [memberStats, setMemberStats] = useState<MemberStatistics | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [showStatsModal, setShowStatsModal] = useState(false)
  const [suspensionData, setSuspensionData] = useState<{
    reason: string
    until: string
  }>({ reason: '', until: '' })

  // 고급 필터링 상태
  const [useAdvancedFilter, setUseAdvancedFilter] = useState(false)
  const [fieldDefinitions, setFieldDefinitions] = useState<FieldDefinition[]>([])
  const [advancedQuery, setAdvancedQuery] = useState<AdvancedSearchQuery | null>(null)
  const [advancedResult, setAdvancedResult] = useState<FilteredResult | null>(null)

  useEffect(() => {
    if (useAdvancedFilter) {
      fetchFieldDefinitions()
    } else {
      fetchMembers()
    }
    fetchMemberStatsData() // 통계는 항상 별도로 로드
  }, [filter, searchTerm, useAdvancedFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // 고급 필터 상태가 변경될 때 쿼리 실행
  useEffect(() => {
    if (useAdvancedFilter && advancedQuery) {
      executeAdvancedSearch(advancedQuery)
    }
  }, [useAdvancedFilter, advancedQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // 필드 정의 조회
  const fetchFieldDefinitions = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/members/advanced-search')
      if (response.ok) {
        const data = await response.json()
        setFieldDefinitions(data.fields)
      }
    } catch (error) {
      console.error('필드 정의 조회 실패:', error)
    }
  }, [])

  // 고급 검색 실행
  const executeAdvancedSearch = useCallback(async (query: AdvancedSearchQuery) => {
    try {
      setLoading(true)
      setError(null)

      const searchQuery = {
        ...query,
        pagination: {
          page: 1,
          limit: 50,
          ...query.pagination,
        },
      }

      const response = await fetch('/api/admin/members/advanced-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchQuery),
      })

      if (!response.ok) {
        throw new Error('고급 검색 중 오류가 발생했습니다.')
      }

      const result: FilteredResult = await response.json()
      setAdvancedResult(result)
      setMembers(result.data)
    } catch (err) {
      console.error('Advanced search error:', err)
      setError(err instanceof Error ? err.message : '고급 검색 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  // 통계 데이터 조회 (메인 통계용)
  const fetchMemberStatsData = useCallback(async () => {
    try {
      setStatsLoading(true)
      const response = await fetch('/api/admin/members/stats')
      if (response.ok) {
        const stats = await response.json()
        setMemberStats(stats.data)
      }
    } catch (error) {
      console.error('📊 통계 데이터 로드 실패:', error)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  // 상세 통계 모달용
  const fetchMemberStats = async () => {
    try {
      const response = await fetch('/api/admin/members/stats')
      if (response.ok) {
        const stats = await response.json()
        setMemberStats(stats.data)
        setShowStatsModal(true)
      }
    } catch (error) {
      console.error('Stats fetch error:', error)
    }
  }

  const handleBulkAction = async (
    action: 'bulk_approve' | 'bulk_reject' | 'bulk_activate' | 'bulk_deactivate' | 'bulk_suspend'
  ) => {
    if (selectedMembers.size === 0) {
      alert('선택된 회원이 없습니다.')
      return
    }

    const memberIds = Array.from(selectedMembers)
    const confirmMessage = `선택된 ${memberIds.length}명의 회원에 대해 ${action}을 수행하시겠습니까?`

    if (!confirm(confirmMessage)) return

    try {
      setBulkActionLoading(true)

      const requestBody: any = {
        operation_type: action,
        member_ids: memberIds,
        parameters: {},
      }

      if (action === 'bulk_suspend') {
        requestBody.parameters.suspension_reason =
          suspensionData.reason || '관리자에 의한 대량 정지'
        if (suspensionData.until) {
          requestBody.parameters.suspension_until = suspensionData.until
        }
      }

      const response = await fetch('/api/admin/members/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '대량 작업에 실패했습니다.')
      }

      const result = await response.json()
      alert(
        `작업이 완료되었습니다. 성공: ${result.summary.success}건, 실패: ${result.summary.errors}건`
      )

      // 선택 해제 및 데이터 새로고침
      setSelectedMembers(new Set())
      setShowBulkActions(false)
      if (useAdvancedFilter && advancedQuery) {
        await executeAdvancedSearch(advancedQuery)
      } else {
        await fetchMembers()
      }

      // 통계도 새로고침
      await fetchMemberStatsData()
    } catch (error) {
      console.error('Bulk action error:', error)
      alert(error instanceof Error ? error.message : '대량 작업에 실패했습니다.')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const handleMemberSelect = (memberId: string) => {
    const newSelected = new Set(selectedMembers)
    if (newSelected.has(memberId)) {
      newSelected.delete(memberId)
    } else {
      newSelected.add(memberId)
    }
    setSelectedMembers(newSelected)
  }

  const handleSelectAll = () => {
    if (selectedMembers.size === filteredMembers.length) {
      setSelectedMembers(new Set())
    } else {
      setSelectedMembers(new Set(filteredMembers.map(m => m.id)))
    }
  }

  const fetchMembers = useCallback(
    async (forceRefresh = false) => {
      try {
        setLoading(true)
        setError(null)

        const params = new URLSearchParams({
          filter,
          search: searchTerm,
          page: '1',
          limit: '50',
        })

        // 강제 새로고침 시 fetch 캐시를 명시적으로 무시
        const fetchOptions: RequestInit = {
          method: 'GET',
        }

        if (forceRefresh) {
          fetchOptions.cache = 'no-store'
          fetchOptions.headers = {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          }
        }

        const response = await fetch(`/api/admin/members?${params}`, fetchOptions)

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || '회원 정보를 불러오는 중 오류가 발생했습니다.')
        }

        const data: MembersResponse = await response.json()
        setMembers(data.members)
      } catch (err) {
        console.error('Members fetch error:', err)
        setError(
          err instanceof Error ? err.message : '회원 정보를 불러오는 중 오류가 발생했습니다.'
        )
      } finally {
        setLoading(false)
      }
    },
    [filter, searchTerm]
  )

  const handleMemberAction = async (
    memberId: string,
    action: 'approve' | 'reject' | 'deactivate' | 'activate' | 'suspend' | 'unsuspend',
    params?: any
  ) => {
    try {
      setActionLoading(memberId)

      const requestBody = { memberId, action, ...params }

      const response = await fetch('/api/admin/member-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        let errorMessage = '회원 상태 변경에 실패했습니다.'

        try {
          // 응답이 JSON인지 확인
          const contentType = response.headers.get('content-type')
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json()
            errorMessage = errorData.error || errorMessage
          } else {
            // HTML이나 다른 형태의 응답
            if (response.status === 405) {
              errorMessage = 'API 메서드가 지원되지 않습니다. 시스템 관리자에게 문의하세요.'
            } else if (response.status === 404) {
              errorMessage = 'API 엔드포인트를 찾을 수 없습니다. 시스템 관리자에게 문의하세요.'
            } else {
              errorMessage = `서버 오류가 발생했습니다. (HTTP ${response.status})`
            }
          }
        } catch (parseError) {
          console.error('❌ Error parsing API response:', parseError)
          errorMessage = `서버 응답을 처리할 수 없습니다. (HTTP ${response.status})`
        }

        throw new Error(errorMessage)
      }

      const successData = await response.json()

      // 성공 메시지 표시
      if (successData.message) {
        alert(successData.message)
      } else {
        alert(`회원 ${action} 처리가 완료되었습니다.`)
      }

      // 성공 시 로컬 상태 즉시 업데이트
      if (successData.member) {
        setMembers(prevMembers => {
          return prevMembers.map(m => (m.id === memberId ? { ...m, ...successData.member } : m))
        })

        // 선택된 회원 정보도 즉시 업데이트
        if (selectedMember && selectedMember.id === memberId) {
          setSelectedMember({ ...selectedMember, ...successData.member })
        }
      }

      // 강제 새로고침으로 최신 데이터 확보
      if (useAdvancedFilter && advancedQuery) {
        await executeAdvancedSearch(advancedQuery)
      } else {
        await fetchMembers(true) // 강제 새로고침
      }

      // 통계도 새로고침
      await fetchMemberStatsData()
    } catch (err) {
      console.error('Member action error:', err)
      alert(err instanceof Error ? err.message : '회원 상태 변경에 실패했습니다.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleFlagsUpdate = async (
    memberId: string,
    flags: { is_director?: boolean; director_title?: string | null; is_auditor?: boolean }
  ) => {
    const response = await fetch('/api/admin/members/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, ...flags }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || '권한 변경에 실패했습니다.')
    }

    const successData = await response.json()

    // 로컬 상태 즉시 업데이트
    if (successData.member) {
      setMembers(prevMembers =>
        prevMembers.map(m => (m.id === memberId ? { ...m, ...successData.member } : m))
      )
      if (selectedMember && selectedMember.id === memberId) {
        setSelectedMember({ ...selectedMember, ...successData.member })
      }
    }
  }

  const handleViewMember = (member: Member) => {
    setSelectedMember(member)
    setIsModalOpen(true)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'approved':
        return 'bg-green-100 text-green-800'
      case 'rejected':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return '승인 대기'
      case 'approved':
        return '승인됨'
      case 'rejected':
        return '거부됨'
      default:
        return '알 수 없음'
    }
  }

  // 고급 필터 모드가 아닐 때만 클라이언트 사이드 필터링 적용
  const filteredMembers = useAdvancedFilter
    ? members
    : members.filter(member => {
        const matchesSearch =
          member.display_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          member.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          member.real_name?.toLowerCase().includes(searchTerm.toLowerCase())

        if (filter === 'all') return matchesSearch
        return matchesSearch && member.registration_status === filter
      })

  // 통계는 별도 API에서 가져오므로 로딩 중 기본값 사용
  const statsData = memberStats || {
    totalMembers: 0,
    activeMembers: 0,
    inactiveMembers: 0,
    pendingMembers: 0,
    approvedMembers: 0,
    rejectedMembers: 0,
    suspendedMembers: 0,
    artistMembers: 0,
    adminMembers: 0,
    directorMembers: 0,
  }

  return (
    <AdminLayout title="회원 관리" description="회원 승인, 거부 및 상태 관리">
      <div className="space-y-6">
        {/* 주요 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">전체 회원</p>
                <p className="text-2xl font-bold text-gray-900">
                  {statsLoading ? '...' : statsData.totalMembers}
                </p>
              </div>
              <FiUsers className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">승인 대기</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {statsLoading ? '...' : statsData.pendingMembers}
                </p>
              </div>
              <FiRefreshCw className="w-8 h-8 text-yellow-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">활성 회원</p>
                <p className="text-2xl font-bold text-green-600">
                  {statsLoading ? '...' : statsData.activeMembers}
                </p>
                <p className="text-xs text-gray-500 mt-1">승인 + 활성</p>
              </div>
              <FiCheck className="w-8 h-8 text-green-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">비활성화된 회원</p>
                <p className="text-2xl font-bold text-orange-600">
                  {statsLoading ? '...' : statsData.inactiveMembers}
                </p>
                <p className="text-xs text-gray-500 mt-1">승인 + 비활성</p>
              </div>
              <FiPause className="w-8 h-8 text-orange-500" />
            </div>
          </div>
        </div>

        {/* 세부 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">전체 승인됨</p>
                <p className="text-2xl font-bold text-blue-600">
                  {statsLoading ? '...' : statsData.approvedMembers}
                </p>
                <p className="text-xs text-gray-500 mt-1">활성 + 비활성</p>
              </div>
              <FiShield className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">거부됨</p>
                <p className="text-2xl font-bold text-red-600">
                  {statsLoading ? '...' : statsData.rejectedMembers}
                </p>
              </div>
              <FiX className="w-8 h-8 text-red-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">정지된 회원</p>
                <p className="text-2xl font-bold text-red-600">
                  {statsLoading ? '...' : statsData.suspendedMembers}
                </p>
              </div>
              <FiAlertCircle className="w-8 h-8 text-red-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">아티스트</p>
                <p className="text-2xl font-bold text-purple-600">
                  {statsLoading ? '...' : statsData.artistMembers}
                </p>
              </div>
              <FiShield className="w-8 h-8 text-purple-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">관리자</p>
                <p className="text-2xl font-bold text-indigo-600">
                  {statsLoading ? '...' : statsData.adminMembers}
                </p>
              </div>
              <FiSettings className="w-8 h-8 text-indigo-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">이사</p>
                <p className="text-2xl font-bold text-teal-600">
                  {statsLoading ? '...' : statsData.directorMembers}
                </p>
                <p className="text-xs text-gray-500 mt-1">이사회 구성원</p>
              </div>
              <FiBriefcase className="w-8 h-8 text-teal-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">통계 보기</p>
                <button
                  onClick={() => fetchMemberStats()}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  자세히 보기
                </button>
              </div>
              <FiBarChart className="w-8 h-8 text-primary-500" />
            </div>
          </div>
        </div>

        {/* 필터 및 검색 */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex flex-col lg:flex-row gap-4 mb-4">
            <div className="flex items-center gap-2 flex-1">
              <FiSearch className="w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="회원명, 이메일, 실명으로 검색..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={useAdvancedFilter}
              />
            </div>
            <div className="flex items-center gap-2">
              <FiFilter className="w-5 h-5 text-gray-400" />
              <select
                value={filter}
                onChange={e => setFilter(e.target.value as any)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={useAdvancedFilter}
              >
                <option value="all">전체</option>
                <option value="pending">승인 대기</option>
                <option value="approved">승인됨</option>
                <option value="rejected">거부됨</option>
              </select>

              <button
                onClick={() => {
                  setUseAdvancedFilter(!useAdvancedFilter)
                  if (useAdvancedFilter) {
                    // 기본 필터로 돌아갈 때 초기화
                    setAdvancedQuery(null)
                    setAdvancedResult(null)
                    fetchMembers()
                  }
                }}
                className={`flex items-center px-3 py-2 rounded-md border transition-colors ${
                  useAdvancedFilter
                    ? 'bg-primary-100 border-primary-300 text-primary-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <FiSettings className="w-4 h-4 mr-2" />
                {useAdvancedFilter ? '기본 필터' : '고급 필터'}
              </button>

              <button
                onClick={
                  useAdvancedFilter
                    ? () => advancedQuery && executeAdvancedSearch(advancedQuery)
                    : () => fetchMembers(true)
                }
                disabled={loading}
                className="flex items-center px-3 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                <FiRefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                새로고침
              </button>

              {/* 대량 작업 버튼 */}
              <button
                onClick={() => setShowBulkActions(!showBulkActions)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
              >
                <FiPackage className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 고급 필터 빌더 */}
          {useAdvancedFilter && fieldDefinitions.length > 0 && (
            <AdvancedFilterBuilder
              fields={fieldDefinitions}
              initialFilters={advancedQuery?.filters}
              initialSorts={advancedQuery?.sorts}
              onChange={query => {
                setAdvancedQuery(query)
                executeAdvancedSearch(query)
              }}
            />
          )}

          {/* 고급 검색 결과 요약 */}
          {useAdvancedFilter && advancedResult && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="text-sm text-blue-800">
                  <span className="font-medium">검색 결과:</span> {advancedResult.filtered}명의 회원
                  (전체 {advancedResult.total}명 중)
                </div>
                <div className="text-xs text-blue-600">
                  페이지 {advancedResult.pagination.page} / {advancedResult.pagination.total_pages}
                </div>
              </div>

              {/* 적용된 필터 요약 */}
              {advancedResult.applied_filters.conditions.length > 0 && (
                <div className="mt-2 text-xs text-blue-700">
                  <span className="font-medium">적용된 필터:</span>{' '}
                  {advancedResult.applied_filters.conditions.length}개 조건
                  {advancedResult.applied_filters.groups &&
                    advancedResult.applied_filters.groups.length > 0 &&
                    `, ${advancedResult.applied_filters.groups.length}개 그룹`}
                </div>
              )}

              {/* 적용된 정렬 요약 */}
              {advancedResult.applied_sorts.length > 0 && (
                <div className="mt-1 text-xs text-blue-700">
                  <span className="font-medium">정렬:</span>{' '}
                  {advancedResult.applied_sorts.map((sort, index) => {
                    const field = fieldDefinitions.find(f => f.name === sort.field)
                    return (
                      <span key={index}>
                        {field?.label || sort.field} (
                        {sort.direction === 'asc' ? '오름차순' : '내림차순'})
                        {index < advancedResult.applied_sorts.length - 1 && ', '}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 대량 작업 패널 */}
        {showBulkActions && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">대량 작업</h3>
              <button
                onClick={() => setShowBulkActions(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">선택된 회원: {selectedMembers.size}명</p>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={
                      selectedMembers.size === filteredMembers.length && filteredMembers.length > 0
                    }
                    onChange={handleSelectAll}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label className="text-sm text-gray-700">전체 선택</label>
                </div>
              </div>

              {selectedMembers.size > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleBulkAction('bulk_approve')}
                    disabled={bulkActionLoading}
                    className="px-3 py-1 text-sm bg-green-100 text-green-800 rounded-md hover:bg-green-200 disabled:opacity-50"
                  >
                    일괄 승인
                  </button>
                  <button
                    onClick={() => handleBulkAction('bulk_reject')}
                    disabled={bulkActionLoading}
                    className="px-3 py-1 text-sm bg-red-100 text-red-800 rounded-md hover:bg-red-200 disabled:opacity-50"
                  >
                    일괄 거부
                  </button>
                  <button
                    onClick={() => handleBulkAction('bulk_activate')}
                    disabled={bulkActionLoading}
                    className="px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200 disabled:opacity-50"
                  >
                    일괄 활성화
                  </button>
                  <button
                    onClick={() => handleBulkAction('bulk_deactivate')}
                    disabled={bulkActionLoading}
                    className="px-3 py-1 text-sm bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 disabled:opacity-50"
                  >
                    일괄 비활성화
                  </button>
                  <button
                    onClick={() => handleBulkAction('bulk_suspend')}
                    disabled={bulkActionLoading}
                    className="px-3 py-1 text-sm bg-orange-100 text-orange-800 rounded-md hover:bg-orange-200 disabled:opacity-50"
                  >
                    일괄 정지
                  </button>
                </div>
              )}

              {bulkActionLoading && (
                <div className="flex items-center text-sm text-gray-500">
                  <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mr-2"></div>
                  대량 작업 수행 중...
                </div>
              )}
            </div>
          </div>
        )}

        {/* 회원 목록 */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">회원 목록</h2>
            <p className="text-sm text-gray-600 mt-1">
              {useAdvancedFilter && advancedResult
                ? `${advancedResult.filtered}명의 회원이 검색되었습니다. (전체 ${advancedResult.total}명 중)`
                : `총 ${filteredMembers.length}명의 회원이 있습니다.`}
            </p>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                        <div>
                          <div className="h-4 bg-gray-200 rounded w-24 mb-2"></div>
                          <div className="h-3 bg-gray-200 rounded w-32"></div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-6 bg-gray-200 rounded"></div>
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
                  onClick={() => fetchMembers(true)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
                >
                  다시 시도
                </button>
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="text-center py-8">
                <FiUsers className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchTerm ? '검색 결과가 없습니다.' : '회원이 없습니다.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredMembers.map(member => (
                  <div key={member.id} className="flex items-center space-x-3">
                    {showBulkActions && (
                      <input
                        type="checkbox"
                        checked={selectedMembers.has(member.id)}
                        onChange={() => handleMemberSelect(member.id)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    )}
                    <div className="flex-1">
                      <MemberCard
                        member={member}
                        onView={() => handleViewMember(member)}
                        onAction={handleMemberAction}
                        isLoading={actionLoading === member.id}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 회원 상세 모달 */}
      {selectedMember && (
        <MemberDetailModal
          member={selectedMember}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onAction={handleMemberAction}
          onFlagsUpdate={handleFlagsUpdate}
          isLoading={actionLoading === selectedMember.id}
        />
      )}
    </AdminLayout>
  )
}
