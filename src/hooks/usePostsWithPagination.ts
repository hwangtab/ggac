'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase/client'
import type { Post, PostWithLikes, SupabaseRealtimePayload } from '@/types'

interface UsePostsWithPaginationProps {
  limit: number
  category?: string
  cursor?: string | null
}

interface PostsResult {
  posts: PostWithLikes[]
  hasNext: boolean
  hasPrev: boolean
  nextCursor: string | null
  prevCursor: string | null
  loading: boolean
  error: string | null
}

export const usePostsWithPagination = ({
  limit,
  category,
  cursor,
}: UsePostsWithPaginationProps): PostsResult => {
  const [posts, setPosts] = useState<PostWithLikes[]>([])
  const [hasNext, setHasNext] = useState(false)
  const [hasPrev, setHasPrev] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [prevCursor, setPrevCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 요청 중복 방지 및 과도한 재요청 방지
  const inFlightRef = useRef(false)
  const lastFetchAtRef = useRef(0)
  const scheduledRefetchRef = useRef<NodeJS.Timeout | null>(null)

  const fetchPosts = useCallback(async () => {
    // 1) 중복 호출 방지: 이미 진행 중이면 무시
    if (inFlightRef.current) {
      return
    }
    // 2) 과도한 빈번 호출 억제: 마지막 호출 1.2초 이내면 무시
    const now = Date.now()
    if (now - lastFetchAtRef.current < 1200) {
      return
    }

    try {
      inFlightRef.current = true
      setLoading(true)
      setError(null)

      // 🚀 최적화된 단일 API 호출: 키셋 페이지네이션
      const params = new URLSearchParams({
        limit: limit.toString(),
        include_likes: 'true',
        ...(category && category !== '전체' && { category }),
        ...(cursor && { cursor }),
      })

      // API 호출을 캐싱과 함께 수행
      const response = await fetch(`/api/posts?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // 🚀 캐싱 최적화: 30초 캐시 적용
        next: { revalidate: 30 },
        cache: 'default', // 브라우저 캐시 활용
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('로그인이 필요합니다.')
        } else if (response.status === 403) {
          throw new Error('승인된 회원만 접근할 수 있습니다.')
        } else {
          throw new Error(`서버 오류: ${response.status}`)
        }
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || '게시글을 불러오는데 실패했습니다.')
      }

      const { posts: newPosts, pagination } = result.data

      // 🚀 API에서 이미 모든 데이터(댓글 수, 좋아요 상태 포함)가 처리되어 옴
      // 더 이상 개별 API 호출이나 Promise.all이 필요하지 않음!
      const postsWithLikes: PostWithLikes[] = newPosts.map((post: any) => ({
        ...post,
        like_count: post.like_count || 0,
        is_liked: post.is_liked || false,
        comment_count: post.comment_count || 0,
      }))

      setPosts(postsWithLikes)
      setHasNext(pagination.has_next)
      setHasPrev(pagination.has_prev)
      setNextCursor(pagination.next_cursor)
      setPrevCursor(pagination.prev_cursor)

    } catch (err) {
      console.error('Error fetching posts:', err)
      setError(err instanceof Error ? err.message : '게시글을 불러오는 중 오류가 발생했습니다.')
      // 오류 시에는 마지막 정상 데이터 유지 (UX 안정)
    } finally {
      lastFetchAtRef.current = Date.now()
      inFlightRef.current = false
      setLoading(false)
    }
  }, [limit, category, cursor])

  // 실시간 업데이트 구독 (최적화됨)
  const subscribeToChanges = useCallback(() => {
    // 모바일 디바이스나 iOS Safari에서는 WebSocket 연결을 비활성화
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    )
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

    // ✅ 실시간 업데이트 최적화: 성능상 이유로 조건부 활성화
    const disableRealtime = false

    if (isMobile || isIOS || disableRealtime) {
      return () => {} // 빈 함수 반환
    }

    try {
      const subscription = supabase
        .channel('posts_changes_optimized')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'posts',
          },
          payload => {
            // 마이너 업데이트 필터링 (좋아요, 조회수 등)
            const realtimePayload = payload as unknown as SupabaseRealtimePayload<Post>
            const eventType = realtimePayload.eventType || realtimePayload.event_type
            const oldRecord = realtimePayload.old || realtimePayload.old_record
            const newRecord = realtimePayload.new || realtimePayload.new_record

            if (eventType === 'UPDATE' && oldRecord && newRecord) {
              // 변경된 필드 분석
              const changedFields = []
              for (const key in newRecord) {
                if (oldRecord[key] !== newRecord[key]) {
                  changedFields.push(key)
                }
              }

              // 좋아요나 조회수만 변경된 마이너 업데이트 감지
              const isMinorUpdate =
                changedFields.length <= 2 &&
                (changedFields.includes('like_count') ||
                  changedFields.includes('view_count') ||
                  changedFields.includes('updated_at'))

              // 중요한 필드 변경 여부 확인
              const hasMajorFieldChanges = changedFields.some(field =>
                ['title', 'content', 'category', 'is_deleted', 'author_id'].includes(field)
              )

              if (isMinorUpdate && !hasMajorFieldChanges) {
                return // 불필요한 새로고침 방지
              }
            }

            // 과도한 재요청 방지: 1.5초 단위로 통합 호출
            if (scheduledRefetchRef.current) {
              return
            }
            scheduledRefetchRef.current = setTimeout(() => {
              scheduledRefetchRef.current = null
              fetchPosts()
            }, 1500)
          }
        )
        .subscribe()

      return () => {
        if (scheduledRefetchRef.current) {
          clearTimeout(scheduledRefetchRef.current)
          scheduledRefetchRef.current = null
        }
        subscription.unsubscribe()
      }
    } catch (error) {
      console.error('❌ [REALTIME] Failed to create subscription:', error)
      return () => {}
    }
  }, [fetchPosts])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  // 실시간 업데이트 구독 (데스크톱에서만)
  useEffect(() => {
    const unsubscribe = subscribeToChanges()
    return unsubscribe
  }, [subscribeToChanges])

  return {
    posts,
    hasNext,
    hasPrev,
    nextCursor,
    prevCursor,
    loading,
    error,
  }
}

// 공지사항만 별도 조회하는 훅 (첫 페이지 고정용)
export const useAnnouncementPosts = () => {
  const [announcements, setAnnouncements] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const { data, error } = await supabase
          .from('posts')
          .select('*')
          .eq('category', '공지')
          .eq('is_deleted', false)
          .order('created_at', { ascending: false })

        if (error) throw error
        setAnnouncements((data as unknown as Post[]) || [])
      } catch (err) {
        console.error('Error fetching announcements:', err)
        setAnnouncements([])
      } finally {
        setLoading(false)
      }
    }

    fetchAnnouncements()
  }, [])

  return { announcements, loading }
}
