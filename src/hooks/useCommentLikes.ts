/**
 * 댓글 좋아요 관리 훅
 * 댓글 좋아요 토글, 상태 관리, 실시간 업데이트 제공
 */

'use client'

import { useState, useCallback, useEffect } from 'react'
import { useLoadingState } from '@/hooks/useLoadingState'
import { fetchSessionProfile } from '@/utils/sessionProfile'

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
  const [userId, setUserId] = useState<string | null>(null)
  const [state, setState] = useState<CommentLikeState>({
    likeCount: initialLikeCount,
    isLiked: initialIsLiked,
  })

  // 로딩 상태 관리
  const loadingState = useLoadingState({
    timeout: 5000,
    enableLogging: true,
    onError: error => {
      console.error('댓글 좋아요 오류:', error)
      setState(prev => ({ ...prev, isLiked: !prev.isLiked })) // 롤백
    },
  })

  const refreshUser = useCallback(async () => {
    const session = await fetchSessionProfile()
    setUserId(session.user?.id ?? null)
    return session.user?.id ?? null
  }, [])

  // 사용자 정보 가져오기
  useEffect(() => {
    void refreshUser()

    const handleFocus = () => {
      void refreshUser()
    }
    window.addEventListener('focus', handleFocus)

    return () => window.removeEventListener('focus', handleFocus)
  }, [refreshUser])

  // 좋아요 토글
  const toggleLike = useCallback(async () => {
    const currentUserId = userId ?? (await refreshUser())
    if (!currentUserId) {
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
      const response = await fetch(`/api/comments/${commentId}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
  }, [userId, refreshUser, commentId, onLikeChange, state.isLiked, state.likeCount, loadingState])

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
    canLike: !!userId,
    reset: loadingState.reset,
  }
}
