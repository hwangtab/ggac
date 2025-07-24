/**
 * 댓글 좋아요 관리 훅
 * 댓글 좋아요 토글, 상태 관리, 실시간 업데이트 제공
 */

'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

interface CommentLikeState {
  /** 좋아요 수 */
  likeCount: number
  /** 현재 사용자의 좋아요 여부 */
  isLiked: boolean
  /** 로딩 상태 */
  isLoading: boolean
  /** 에러 상태 */
  error: string | null
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
  onLikeChange
}: UseCommentLikesProps) {
  const [user, setUser] = useState<any>(null)
  const [state, setState] = useState<CommentLikeState>({
    likeCount: initialLikeCount,
    isLiked: initialIsLiked,
    isLoading: false,
    error: null
  })

  const supabase = createClientComponentClient()

  // 사용자 정보 가져오기
  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user || null)
    }
    
    getUser()

    // 인증 상태 변경 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null)
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  // 좋아요 토글
  const toggleLike = useCallback(async () => {
    if (!user) {
      setState(prev => ({ 
        ...prev, 
        error: '로그인이 필요합니다.' 
      }))
      return false
    }

    if (!commentId) {
      setState(prev => ({ 
        ...prev, 
        error: '댓글 정보가 없습니다.' 
      }))
      return false
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      // 토큰 가져오기
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error('인증 토큰이 없습니다.')
      }

      const response = await fetch(`/api/comments/${commentId}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '좋아요 처리에 실패했습니다.')
      }

      // 상태 업데이트
      setState(prev => ({
        ...prev,
        likeCount: data.like_count,
        isLiked: data.liked,
        isLoading: false
      }))

      // 콜백 호출
      onLikeChange?.(data.liked, data.like_count)

      return true

    } catch (error) {
      console.error('댓글 좋아요 토글 오류:', error)
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : '좋아요 처리에 실패했습니다.',
        isLoading: false
      }))
      return false
    }
  }, [user, commentId, onLikeChange, supabase])

  // 에러 클리어
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  return {
    // 상태
    likeCount: state.likeCount,
    isLiked: state.isLiked,
    isLoading: state.isLoading,
    error: state.error,
    
    // 액션
    toggleLike,
    clearError,
    
    // 유틸
    canLike: !!user
  }
}