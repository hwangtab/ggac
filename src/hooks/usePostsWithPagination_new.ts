/**
 * 게시글 목록 페이지네이션 훅 (새로운 API 래퍼 사용)
 * 
 * 새로운 클라이언트 API 래퍼를 사용하여 더 안정적이고 타입 안전한 게시글 목록을 제공합니다.
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiGet, configureClientApi } from '@/utils/clientApiWrapper'
import { useLoadingState } from '@/hooks/useLoadingState'
import type { PostWithLikes } from '@/types'

// API 응답 타입 정의
interface PostListApiResponse {
  posts: PostWithLikes[]
  pagination: {
    current_page: number
    total_pages: number
    total_count: number
    per_page: number
    has_next: boolean
    has_prev: boolean
  }
  filters: {
    category: string | null
    search: string | null
    sort_by: string
    sort_order: string
  }
}

interface UsePostsWithPaginationProps {
  page: number
  pageSize: number
  category?: string
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  includeLikes?: boolean
  autoRefresh?: boolean
  refreshInterval?: number
}

interface PostsResult {
  posts: PostWithLikes[]
  totalCount: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
  loading: boolean
  error: string | null
  refreshing: boolean
  refetch: () => Promise<void>
  clearError: () => void
  reset: () => void
}

// 클라이언트 API 설정
if (typeof window !== 'undefined') {
  configureClientApi({
    timeout: 15000,
    retryAttempts: 2,
    retryDelay: 1000,
    debug: process.env.NODE_ENV === 'development'
  })
}

export const usePostsWithPagination = ({
  page,
  pageSize,
  category,
  search,
  sortBy = 'created_at',
  sortOrder = 'desc',
  includeLikes = true,
  autoRefresh = false,
  refreshInterval = 30000 // 30초
}: UsePostsWithPaginationProps): PostsResult => {
  const [posts, setPosts] = useState<PostWithLikes[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [hasPrev, setHasPrev] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  
  // 자동 새로고침을 위한 타이머 참조
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(true)

  // 로딩 상태 관리
  const loadingState = useLoadingState({
    timeout: 15000,
    enableLogging: true,
    onError: (error) => {
      console.error('게시글 목록 조회 오류:', error)
    }
  })

  // API 호출 함수
  const fetchPosts = useCallback(async (isRefresh = false) => {
    if (!mountedRef.current) return

    try {
      if (isRefresh) {
        setRefreshing(true)
      }

      const params = {
        page: page.toString(),
        limit: pageSize.toString(),
        sort: sortBy,
        order: sortOrder,
        include_likes: includeLikes.toString(),
        ...(category && category !== '전체' && { category }),
        ...(search && { search })
      }

      const cacheKey = `posts:${JSON.stringify(params)}`
      
      const response = await apiGet<PostListApiResponse>('/api/posts', params, {
        useCache: true,
        cacheKey,
        cacheTTL: 60000, // 1분 캐시
        timeout: 15000
      })

      if (!mountedRef.current) return

      const { posts: newPosts, pagination } = response.data
      
      setPosts(newPosts)
      setTotalCount(pagination.total_count)
      setTotalPages(pagination.total_pages)
      setHasNext(pagination.has_next)
      setHasPrev(pagination.has_prev)

    } catch (error) {
      if (!mountedRef.current) return
      throw error
    } finally {
      if (mountedRef.current && isRefresh) {
        setRefreshing(false)
      }
    }
  }, [page, pageSize, category, search, sortBy, sortOrder, includeLikes])

  // 래퍼를 사용한 안전한 API 호출
  const safeFetchPosts = useCallback(async (isRefresh = false) => {
    return loadingState.executeAsync(async () => {
      await fetchPosts(isRefresh)
    })
  }, [fetchPosts, loadingState])

  // 수동 새로고침
  const refetch = useCallback(async () => {
    await safeFetchPosts(true)
  }, [safeFetchPosts])

  // 에러 클리어
  const clearError = useCallback(() => {
    loadingState.clearError()
  }, [loadingState])

  // 상태 초기화
  const reset = useCallback(() => {
    setPosts([])
    setTotalCount(0)
    setTotalPages(0)
    setHasNext(false)
    setHasPrev(false)
    loadingState.reset()
  }, [loadingState])

  // 자동 새로고침 설정
  useEffect(() => {
    if (autoRefresh && refreshInterval > 0) {
      refreshTimerRef.current = setInterval(() => {
        if (!loadingState.isLoading && !refreshing) {
          refetch()
        }
      }, refreshInterval)

      return () => {
        if (refreshTimerRef.current) {
          clearInterval(refreshTimerRef.current)
          refreshTimerRef.current = null
        }
      }
    }
  }, [autoRefresh, refreshInterval, loadingState.isLoading, refreshing, refetch])

  // 파라미터 변경 시 데이터 재조회
  useEffect(() => {
    safeFetchPosts(false)
  }, [page, pageSize, category, search, sortBy, sortOrder, includeLikes])

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
      }
    }
  }, [])

  return {
    posts,
    totalCount,
    totalPages,
    hasNext,
    hasPrev,
    loading: loadingState.isLoading,
    error: loadingState.error,
    refreshing,
    refetch,
    clearError,
    reset
  }
}

/**
 * 게시글 목록 무한 스크롤 훅
 */
interface UseInfinitePostsProps {
  pageSize?: number
  category?: string
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  includeLikes?: boolean
}

interface InfinitePostsResult {
  posts: PostWithLikes[]
  loading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
  reset: () => void
}

export const useInfinitePosts = ({
  pageSize = 20,
  category,
  search,
  sortBy = 'created_at',
  sortOrder = 'desc',
  includeLikes = true
}: UseInfinitePostsProps = {}): InfinitePostsResult => {
  const [posts, setPosts] = useState<PostWithLikes[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchNextPage = useCallback(async (resetPosts = false) => {
    if (loading) return

    try {
      setLoading(true)
      setError(null)

      const currentPage = resetPosts ? 1 : page
      
      const params = {
        page: currentPage.toString(),
        limit: pageSize.toString(),
        sort: sortBy,
        order: sortOrder,
        include_likes: includeLikes.toString(),
        ...(category && category !== '전체' && { category }),
        ...(search && { search })
      }

      const response = await apiGet<PostListApiResponse>('/api/posts', params, {
        timeout: 15000
      })

      const { posts: newPosts, pagination } = response.data
      
      if (resetPosts) {
        setPosts(newPosts)
        setPage(2)
      } else {
        setPosts(prev => [...prev, ...newPosts])
        setPage(prev => prev + 1)
      }
      
      setHasMore(pagination.has_next)

    } catch (error) {
      setError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, category, search, sortBy, sortOrder, includeLikes, loading])

  const loadMore = useCallback(() => fetchNextPage(false), [fetchNextPage])
  const refresh = useCallback(() => fetchNextPage(true), [fetchNextPage])

  const reset = useCallback(() => {
    setPosts([])
    setPage(1)
    setHasMore(true)
    setLoading(false)
    setError(null)
  }, [])

  // 초기 로드 및 파라미터 변경 시 새로고침
  useEffect(() => {
    refresh()
  }, [category, search, sortBy, sortOrder, includeLikes])

  return {
    posts,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    reset
  }
}