'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FiEdit3,
  FiEye,
  FiTrash2,
  FiSearch,
  FiFilter,
  FiRefreshCw,
  FiBookmark,
  FiMessageSquare,
  FiCalendar,
  FiUser,
  FiSettings,
} from 'react-icons/fi'
import AdminLayout from '../components/AdminLayout'
import PostCard from './components/PostCard'
import PostDetailModal from './components/PostDetailModal'
import AdvancedFilterBuilder from '@/components/AdvancedFilterBuilder'
import type { Post, AdvancedSearchQuery, FilteredResult, FieldDefinition } from '@/types'

interface PostsResponse {
  posts: Post[]
  pagination: {
    currentPage: number
    totalPages: number
    totalCount: number
    hasNext: boolean
  }
}

interface PostStats {
  totalPosts: number
  totalDeleted: number
  totalPinned: number
  categoryStats: {
    공지: number
    잡담: number
    홍보: number
    건의: number
  }
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [stats, setStats] = useState<PostStats>({
    totalPosts: 0,
    totalDeleted: 0,
    totalPinned: 0,
    categoryStats: { 공지: 0, 잡담: 0, 홍보: 0, 건의: 0 },
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('전체')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [filter, setFilter] = useState<
    'all' | '공지' | '잡담' | '홍보' | '건의' | 'deleted' | 'pinned'
  >('all')
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // 고급 필터링 상태
  const [useAdvancedFilter, setUseAdvancedFilter] = useState(false)
  const [fieldDefinitions, setFieldDefinitions] = useState<FieldDefinition[]>([])
  const [advancedQuery, setAdvancedQuery] = useState<AdvancedSearchQuery | null>(null)
  const [advancedResult, setAdvancedResult] = useState<FilteredResult | null>(null)

  // 필드 정의 조회
  const fetchFieldDefinitions = async () => {
    try {
      const response = await fetch('/api/admin/posts/advanced-search')
      if (response.ok) {
        const payload = await response.json()
        setFieldDefinitions(payload.data.fields)
      }
    } catch (error) {
      console.error('필드 정의 조회 실패:', error)
    }
  }

  // 고급 검색 실행
  const executeAdvancedSearch = useCallback(
    async (query: AdvancedSearchQuery) => {
      try {
        setLoading(true)
        setError(null)

        const searchQuery = {
          ...query,
          pagination: {
            page: currentPage,
            limit: 20,
            ...query.pagination,
          },
        }

        const response = await fetch('/api/admin/posts/advanced-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchQuery),
        })

        if (!response.ok) {
          throw new Error('고급 검색 중 오류가 발생했습니다.')
        }

        const searchPayload = await response.json()
        const result: FilteredResult = searchPayload.data
        setAdvancedResult(result)
        setPosts(result.data)
        setTotalPages(result.pagination.total_pages)

        // 통계는 별도 조회
        const statsResponse = await fetch('/api/admin/posts/stats')
        if (statsResponse.ok) {
          const statsPayload = await statsResponse.json()
          const statsData: PostStats = statsPayload.data
          setStats(statsData)
        }
      } catch (err) {
        console.error('Advanced search error:', err)
        setError(err instanceof Error ? err.message : '고급 검색 중 오류가 발생했습니다.')
      } finally {
        setLoading(false)
      }
    },
    [currentPage]
  )

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [postsResponse, statsResponse] = await Promise.all([
        fetch(
          `/api/admin/posts?${new URLSearchParams({
            filter,
            search: searchTerm,
            page: currentPage.toString(),
            limit: '20',
          })}`
        ),
        fetch('/api/admin/posts/stats'),
      ])

      if (!postsResponse.ok || !statsResponse.ok) {
        throw new Error('데이터를 불러오는 중 오류가 발생했습니다.')
      }

      const postsPayload = await postsResponse.json()
      const statsPayload = await statsResponse.json()
      const postsData: PostsResponse = postsPayload.data
      const statsData: PostStats = statsPayload.data

      setPosts(postsData.posts)
      setStats(statsData)
      setTotalPages(postsData.pagination.totalPages)
    } catch (err) {
      console.error('Data fetch error:', err)
      setError(err instanceof Error ? err.message : '데이터를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [filter, searchTerm, currentPage])

  useEffect(() => {
    if (useAdvancedFilter) {
      fetchFieldDefinitions()
    } else {
      fetchData()
    }
  }, [filter, searchTerm, currentPage, useAdvancedFilter, fetchData])

  // 고급 필터 상태가 변경될 때 쿼리 실행
  useEffect(() => {
    if (useAdvancedFilter && advancedQuery) {
      executeAdvancedSearch(advancedQuery)
    }
  }, [currentPage, useAdvancedFilter, advancedQuery, executeAdvancedSearch])

  const handlePostAction = async (
    postId: string,
    action: 'delete' | 'restore' | 'pin' | 'unpin'
  ) => {
    try {
      setActionLoading(postId)

      const response = await fetch(`/api/admin/posts/${postId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '게시글 처리에 실패했습니다.')
      }

      // 데이터 새로고침 (현재 필터 모드에 따라)
      if (useAdvancedFilter && advancedQuery) {
        await executeAdvancedSearch(advancedQuery)
      } else {
        await fetchData()
      }

      // 모달이 열려있다면 게시글 정보 업데이트
      if (selectedPost && selectedPost.id === postId) {
        const updatedPost = posts.find(p => p.id === postId)
        if (updatedPost) {
          setSelectedPost(updatedPost)
        }
      }
    } catch (err) {
      console.error('Post action error:', err)
      alert(err instanceof Error ? err.message : '게시글 처리에 실패했습니다.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleViewPost = (post: Post) => {
    setSelectedPost(post)
    setIsModalOpen(true)
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
    setCurrentPage(1) // 검색 시 첫 페이지로 이동
  }

  const handleFilterChange = (newFilter: typeof filter) => {
    setFilter(newFilter)
    setCurrentPage(1) // 필터 변경 시 첫 페이지로 이동
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  const getFilterLabel = (filter: string) => {
    switch (filter) {
      case 'all':
        return '전체'
      case 'deleted':
        return '삭제됨'
      case 'pinned':
        return '고정됨'
      default:
        return filter
    }
  }

  // 고급 필터 모드가 아닐 때만 클라이언트 사이드 필터링 적용
  const displayedPosts = useAdvancedFilter
    ? posts
    : posts.filter(post => {
        const matchesSearch =
          !searchTerm ||
          post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          post.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (post.author?.display_name || post.author?.name || '')
            .toLowerCase()
            .includes(searchTerm.toLowerCase())

        const matchesCategory = selectedCategory === '전체' || post.category === selectedCategory
        const matchesStatus =
          selectedStatus === 'all' ||
          (selectedStatus === 'active' && !post.is_deleted) ||
          (selectedStatus === 'deleted' && post.is_deleted)

        return matchesSearch && matchesCategory && matchesStatus
      })

  return (
    <AdminLayout title="게시글 관리" description="게시글 및 댓글 관리">
      <div className="space-y-6">
        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">전체 게시글</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalPosts}</p>
              </div>
              <FiEdit3 className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">고정된 게시글</p>
                <p className="text-2xl font-bold text-green-600">{stats.totalPinned}</p>
              </div>
              <FiBookmark className="w-8 h-8 text-green-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">삭제된 게시글</p>
                <p className="text-2xl font-bold text-red-600">{stats.totalDeleted}</p>
              </div>
              <FiTrash2 className="w-8 h-8 text-red-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">공지사항</p>
                <p className="text-2xl font-bold text-purple-600">{stats.categoryStats.공지}</p>
              </div>
              <FiMessageSquare className="w-8 h-8 text-purple-500" />
            </div>
          </div>
        </div>

        {/* 카테고리별 통계 */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">카테고리별 통계</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(stats.categoryStats).map(([category, count]) => (
              <div key={category} className="text-center">
                <div className="text-2xl font-bold text-gray-900">{count}</div>
                <div className="text-sm text-gray-600">{category}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 검색 및 필터 */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex flex-col lg:flex-row gap-4 mb-4">
            <div className="flex items-center gap-2 flex-1">
              <FiSearch className="w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="제목, 내용, 작성자로 검색..."
                value={searchTerm}
                onChange={handleSearchChange}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={useAdvancedFilter}
              />
            </div>
            <div className="flex items-center gap-2">
              <FiFilter className="w-5 h-5 text-gray-400" />
              <select
                value={filter}
                onChange={e => handleFilterChange(e.target.value as typeof filter)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={useAdvancedFilter}
              >
                <option value="all">전체</option>
                <option value="공지">공지사항</option>
                <option value="잡담">잡담</option>
                <option value="홍보">홍보</option>
                <option value="건의">건의사항</option>
                <option value="pinned">고정됨</option>
                <option value="deleted">삭제됨</option>
              </select>

              <button
                onClick={() => {
                  setUseAdvancedFilter(!useAdvancedFilter)
                  if (useAdvancedFilter) {
                    // 기본 필터로 돌아갈 때 초기화
                    setAdvancedQuery(null)
                    setAdvancedResult(null)
                    fetchData()
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
                    : fetchData
                }
                className="flex items-center px-3 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
              >
                <FiRefreshCw className="w-4 h-4 mr-2" />
                새로고침
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
                  <span className="font-medium">검색 결과:</span> {advancedResult.filtered}개 게시글
                  (전체 {advancedResult.total}개 중)
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

        {/* 게시글 목록 */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">게시글 목록</h2>
            <p className="text-sm text-gray-600 mt-1">
              {useAdvancedFilter && advancedResult
                ? `${advancedResult.filtered}개의 게시글이 검색되었습니다. (전체 ${advancedResult.total}개 중)`
                : `총 ${displayedPosts.length}개의 게시글이 있습니다. (${getFilterLabel(filter)})`}
            </p>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/4"></div>
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
            ) : displayedPosts.length === 0 ? (
              <div className="text-center py-8">
                <FiEdit3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchTerm ? '검색 결과가 없습니다.' : '게시글이 없습니다.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {displayedPosts.map((post: Post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onView={() => handleViewPost(post)}
                    onAction={handlePostAction}
                    isLoading={actionLoading === post.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center space-x-2 p-6 border-t border-gray-200">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-1 bg-gray-200 text-gray-700 rounded disabled:opacity-50"
              >
                이전
              </button>

              {[...Array(totalPages)].map((_, i) => (
                <button
                  key={i + 1}
                  onClick={() => handlePageChange(i + 1)}
                  className={`px-3 py-1 rounded ${
                    currentPage === i + 1
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {i + 1}
                </button>
              ))}

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 bg-gray-200 text-gray-700 rounded disabled:opacity-50"
              >
                다음
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 게시글 상세 모달 */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onAction={handlePostAction}
          isLoading={actionLoading === selectedPost.id}
        />
      )}
    </AdminLayout>
  )
}
