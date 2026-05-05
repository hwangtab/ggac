/**
 * 댓글 좋아요 관리 훅
 * 댓글 좋아요 토글, 상태 관리, 실시간 업데이트 제공
 */

'use client'

import { useState, useCallback, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useLoadingState } from '@/hooks/useLoadingState'

interface CommentLikeState {
  /** 좋아요 수 */
  likeCount: number
  /** 현재 사용자의 좋아요 여부 */
  isLiked: boolean
}

interface UseCommentLikesProps {
  /** 댓글 ID */
  commentId: string
  /** 초기 좋아요 수 */
  initialLikeCount?: number
  /** 초기 좋아요 상태 */
  initialIsLiked?: boolean
  /** 상태 변경 콜백 */
  onLikeChange?: (liked: boolean, count: number) => void
}

export function useCommentLikes({
  commentId,
  initialLikeCount = 0,
  initialIsLiked = false,
  onLikeChange,
}: UseCommentLikesProps) {
  const [user, setUser] = useState<User | null>(null)
  const [state, setState] = useState<CommentLikeState>({
    likeCount: initialLikeCount,
    isLiked: initialIsLiked,
  })

  const supabase = getSupabaseClient()

  // 로딩 상태 관리
  const loadingState = useLoadingState({
    timeout: 5000,
    enableLogging: true,
    onError: error => {
      console.error('댓글 좋아요 오류:', error)
      setState(prev => ({ ...prev, isLiked: !prev.isLiked })) // 롤백
    },
  })

  // 사용자 정보 가져오기
  useEffect(() => {
    const getUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      setUser(session?.user || null)
    }

    getUser()

    // 인증 상태 변경 리스너
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null)
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  // 좋아요 토글
  const toggleLike = useCallback(async () => {
    if (!user) {
      loadingState.failLoading('로그인이 필요합니다.')
      return false
    }

    if (!commentId) {
      loadingState.failLoading('댓글 정보가 없습니다.')
      return false
    }

    // Optimistic update
    const optimisticIsLiked = !state.isLiked
    const optimisticCount = optimisticIsLiked ? state.likeCount + 1 : state.likeCount - 1
    setState(prev => ({
      ...prev,
      isLiked: optimisticIsLiked,
      likeCount: optimisticCount,
    }))

    // 즉시 콜백 호출
    onLikeChange?.(optimisticIsLiked, optimisticCount)

    return loadingState.executeAsync(async () => {
      // 토큰 가져오기
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error('인증 토큰이 없습니다.')
      }

      const response = await fetch(`/api/comments/${commentId}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '좋아요 처리에 실패했습니다.')
      }

      // 실제 상태로 업데이트
      setState(prev => ({
        ...prev,
        likeCount: data.like_count,
        isLiked: data.liked,
      }))

      // 최종 콜백 호출
      onLikeChange?.(data.liked, data.like_count)

      return data
    })
  }, [user, commentId, onLikeChange, supabase, state.isLiked, state.likeCount, loadingState])

  // 에러 클리어
  const clearError = useCallback(() => {
    loadingState.clearError()
  }, [loadingState])

  return {
    // 상태
    likeCount: state.likeCount,
    isLiked: state.isLiked,
    isLoading: loadingState.isLoading,
    error: loadingState.error,

    // 액션
    toggleLike,
    clearError,

    // 유틸
    canLike: !!user,
    reset: loadingState.reset,
  }
}
