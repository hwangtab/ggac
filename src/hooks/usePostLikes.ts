/**
 * 게시글 좋아요 관리 훅
 * 좋아요 토글, 상태 관리, 실시간 업데이트 제공
 */

'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { PostLikeToggleResponse } from '@/types'
import { logLikeAdded, logLikeRemoved } from '@/utils/activityLogger'

interface PostLikeState {
  /** 좋아요 수 */
  likeCount: number
  /** 현재 사용자의 좋아요 여부 */
  isLiked: boolean
  /** 로딩 상태 */
  isLoading: boolean
  /** 에러 상태 */
  error: string | null
}

interface UsePostLikesProps {
  /** 게시글 ID */
  postId: string
  /** 초기 좋아요 수 */
  initialLikeCount?: number
  /** 초기 좋아요 상태 */
  initialIsLiked?: boolean
  /** 상태 변경 콜백 */
  onLikeChange?: (liked: boolean, count: number) => void
}

export function usePostLikes({
  postId,
  initialLikeCount = 0,
  initialIsLiked = false,
  onLikeChange
}: UsePostLikesProps) {
  const [user, setUser] = useState<any>(null)
  const [state, setState] = useState<PostLikeState>({
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

  // 좋아요 상태 초기화 및 조회
  const fetchLikeStatus = useCallback(async () => {
    if (!user || !postId) return

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const response = await fetch(`/api/posts/${postId}/likes`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '좋아요 정보를 불러올 수 없습니다.')
      }

      setState(prev => ({
        ...prev,
        likeCount: data.like_count,
        isLiked: data.is_liked,
        isLoading: false
      }))

    } catch (error) {
      console.error('좋아요 상태 조회 오류:', error)
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
        isLoading: false
      }))
    }
  }, [user, postId])

  // 좋아요 토글
  const toggleLike = useCallback(async () => {
    if (!user) {
      setState(prev => ({ 
        ...prev, 
        error: '로그인이 필요합니다.' 
      }))
      return false
    }

    if (!postId) {
      setState(prev => ({ 
        ...prev, 
        error: '게시글 정보가 없습니다.' 
      }))
      return false
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const response = await fetch(`/api/posts/${postId}/likes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const data: PostLikeToggleResponse = await response.json()

      if (!response.ok) {
        throw new Error(data.message || '좋아요 처리에 실패했습니다.')
      }

      // 활동 로깅
      try {
        if (data.liked) {
          await logLikeAdded(postId);
        } else {
          await logLikeRemoved(postId);
        }
      } catch (logError) {
        console.error('활동 로깅 오류:', logError);
        // 로깅 실패는 사용자 경험에 영향주지 않음
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
      console.error('좋아요 토글 오류:', error)
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : '좋아요 처리에 실패했습니다.',
        isLoading: false
      }))
      return false
    }
  }, [user, postId, onLikeChange])

  // 에러 클리어
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  // 사용자 로그인 상태 변경 시 좋아요 상태 조회
  useEffect(() => {
    if (user && postId) {
      fetchLikeStatus()
    }
  }, [user, postId, fetchLikeStatus])

  return {
    // 상태
    likeCount: state.likeCount,
    isLiked: state.isLiked,
    isLoading: state.isLoading,
    error: state.error,
    
    // 액션
    toggleLike,
    refreshLikeStatus: fetchLikeStatus,
    clearError,
    
    // 유틸
    canLike: !!user
  }
}

/**
 * 여러 게시글의 좋아요 상태를 관리하는 훅
 */
interface UsePostLikesMapProps {
  /** 게시글 ID와 초기 상태 맵 */
  posts: Record<string, { likeCount: number; isLiked: boolean }>
  /** 상태 변경 콜백 */
  onLikeChange?: (postId: string, liked: boolean, count: number) => void
}

export function usePostLikesMap({ posts, onLikeChange }: UsePostLikesMapProps) {
  const [user, setUser] = useState<any>(null)
  const [likesMap, setLikesMap] = useState(posts)
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({})
  const [errorMap, setErrorMap] = useState<Record<string, string>>({})

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

  // 특정 게시글 좋아요 토글
  const toggleLike = useCallback(async (postId: string) => {
    if (!user) {
      setErrorMap(prev => ({ ...prev, [postId]: '로그인이 필요합니다.' }))
      return false
    }

    setLoadingMap(prev => ({ ...prev, [postId]: true }))
    setErrorMap(prev => ({ ...prev, [postId]: '' }))

    try {
      const response = await fetch(`/api/posts/${postId}/likes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const data: PostLikeToggleResponse = await response.json()

      if (!response.ok) {
        throw new Error(data.message || '좋아요 처리에 실패했습니다.')
      }

      // 상태 업데이트
      setLikesMap(prev => ({
        ...prev,
        [postId]: {
          likeCount: data.like_count,
          isLiked: data.liked
        }
      }))

      setLoadingMap(prev => ({ ...prev, [postId]: false }))
      
      // 콜백 호출
      onLikeChange?.(postId, data.liked, data.like_count)

      return true

    } catch (error) {
      console.error('좋아요 토글 오류:', error)
      setErrorMap(prev => ({
        ...prev,
        [postId]: error instanceof Error ? error.message : '좋아요 처리에 실패했습니다.'
      }))
      setLoadingMap(prev => ({ ...prev, [postId]: false }))
      return false
    }
  }, [user, onLikeChange])

  // 에러 클리어
  const clearError = useCallback((postId: string) => {
    setErrorMap(prev => ({ ...prev, [postId]: '' }))
  }, [])

  return {
    // 상태
    likesMap,
    loadingMap,
    errorMap,
    
    // 액션
    toggleLike,
    clearError,
    
    // 유틸
    canLike: !!user,
    getLikeData: (postId: string) => likesMap[postId] || { likeCount: 0, isLiked: false },
    isLoading: (postId: string) => loadingMap[postId] || false,
    getError: (postId: string) => errorMap[postId] || null
  }
}