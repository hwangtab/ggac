/**
 * 게시글 좋아요 관리 훅
 * 좋아요 토글, 상태 관리, 실시간 업데이트 제공
 */

'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { PostLikeToggleResponse } from '@/types'
import { createLogger } from '@/utils/logger'
import { useMultiLoadingState } from '@/hooks/useLoadingState'

const log = createLogger('usePostLikes');

interface PostLikeState {
  /** 좋아요 수 */
  likeCount: number
  /** 현재 사용자의 좋아요 여부 */
  isLiked: boolean
}

interface UsePostLikesProps {
  /** 게시글 ID */
  postId: string
  /** 초기 좋아요 수 */
  initialLikeCount?: number
  /** 초기 좋아요 상태 */
  initialIsLiked?: boolean
  /** 상태 변경 콜백 */
  onLikeChange?: (postId: string, liked: boolean, count: number) => void
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
    isLiked: initialIsLiked
  })

  const supabase = createClientComponentClient()
  
  // 중복 요청 방지 및 캐싱
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastFetchRef = useRef<string>('')
  
  // 로딩 상태 관리
  const multiLoadingState = useMultiLoadingState({
    timeout: 5000,
    enableLogging: true,
    onError: (error) => {
      log.error('PostLikes 작업 오류:', error)
    }
  })
  
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

  // 좋아요 상태 초기화 및 조회 - 디바운싱 및 중복 방지 추가
  const fetchLikeStatus = useCallback(async (force: boolean = false) => {
    if (!user || !postId) return

    // 중복 요청 방지 - 같은 요청이 이미 진행 중이면 무시
    const fetchKey = `${user.id}-${postId}`
    if (!force && lastFetchRef.current === fetchKey) {
      log.debug('중복 요청 방지:', fetchKey);
      return
    }

    // 이전 타임아웃 클리어
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
    }

    lastFetchRef.current = fetchKey
    multiLoadingState.startLoading('fetch')

    try {
      log.debug('GET 요청 시작:', `/api/posts/${postId}/likes`);
      
      const response = await fetch(`/api/posts/${postId}/likes`)
      
      log.debug('GET 응답:', response.status, response.statusText);
      
      if (!response.ok) {
        let errorMessage = '좋아요 정보를 불러올 수 없습니다.';
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          log.error('JSON 파싱 실패:', parseError);
          if (response.status === 404) {
            errorMessage = 'API 엔드포인트를 찾을 수 없습니다.';
          } else if (response.status >= 500) {
            errorMessage = '서버 오류가 발생했습니다.';
          }
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      log.debug('GET 데이터:', data);

      setState(prev => ({
        ...prev,
        likeCount: data.like_count || 0,
        isLiked: data.is_liked || false
      }))
      
      multiLoadingState.finishLoading('fetch', data)

    } catch (error) {
      log.error('GET 오류:', error)
      multiLoadingState.failLoading('fetch', error as Error)
    } finally {
      // 요청 완료 후 일정 시간 후 중복 방지 키 리셋 (디바운싱)
      fetchTimeoutRef.current = setTimeout(() => {
        lastFetchRef.current = ''
      }, 1000) // 1초 후 리셋
    }
  }, [user?.id, postId]) // user 대신 user?.id로 변경하여 불필요한 재호출 방지

  // 좋아요 토글
  const toggleLike = useCallback(async () => {
    log.debug('toggleLike 시작', { 
      postId, 
      hasUser: !!user,
      isToggling: multiLoadingState.getLoadingState('toggle').isLoading
    })
    
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

    // 중복 처리 방지
    if (multiLoadingState.getLoadingState('toggle').isLoading) {
      log.debug('이미 처리 중 - 요청 무시');
      return false
    }
    
    // Optimistic update - UI 즉시 업데이트
    const optimisticIsLiked = !state.isLiked
    const optimisticCount = optimisticIsLiked ? state.likeCount + 1 : state.likeCount - 1
    
    setState(prev => ({ 
      ...prev, 
      isLiked: optimisticIsLiked, 
      likeCount: optimisticCount
    }))
    
    multiLoadingState.startLoading('toggle')
    
    // 부모 컴포넌트에 즉시 알림 (실시간 업데이트보다 빠른 UI 반영)
    if (onLikeChange) {
      log.debug('Optimistic update - 부모에 즉시 알림:', {
        postId,
        liked: optimisticIsLiked,
        count: optimisticCount
      })
      onLikeChange(postId, optimisticIsLiked, optimisticCount)
    }

    try {
      const response = await fetch(`/api/posts/${postId}/likes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      log.debug('POST 응답:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        log.error('POST 응답 오류:', response.status);
        
        let errorMessage = '좋아요 처리에 실패했습니다.';
        
        try {
          const errorData = await response.json();
          log.error('서버 에러 응답:', errorData);
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (parseError) {
          log.error('JSON 파싱 실패:', parseError);
          if (response.status === 401) {
            errorMessage = '로그인이 필요합니다.';
          } else if (response.status === 403) {
            errorMessage = '좋아요 권한이 없습니다.';
          } else if (response.status === 404) {
            errorMessage = 'API 엔드포인트를 찾을 수 없습니다.';
          } else if (response.status >= 500) {
            errorMessage = '서버 오류가 발생했습니다.';
          }
        }
        
        throw new Error(errorMessage);
      }

      const successData: PostLikeToggleResponse = await response.json();
      log.debug('POST 성공:', successData);

      // 상태 업데이트
      setState(prev => ({
        ...prev,
        likeCount: successData.like_count,
        isLiked: successData.liked
      }))
      
      multiLoadingState.finishLoading('toggle', successData)

      // 콜백 호출 (postId 포함)
      onLikeChange?.(postId, successData.liked, successData.like_count)

      return true

    } catch (error) {
      log.error('POST 오류:', error)
      
      // Optimistic update 롤백
      const rollbackIsLiked = !optimisticIsLiked
      const rollbackCount = rollbackIsLiked ? optimisticCount + 1 : optimisticCount - 1
      
      let errorMessage = '좋아요 처리에 실패했습니다.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      setState(prev => ({
        ...prev,
        isLiked: rollbackIsLiked,
        likeCount: rollbackCount
      }))
      
      multiLoadingState.failLoading('toggle', errorMessage)
      
      // 부모 컴포넌트에 롤백 알림
      if (onLikeChange) {
        log.debug('에러 발생 - 롤백 알림:', {
          postId,
          liked: rollbackIsLiked,
          count: rollbackCount
        })
        onLikeChange(postId, rollbackIsLiked, rollbackCount)
      }
      
      return false
    }
  }, [user, postId, onLikeChange, state.isLiked, state.likeCount])

  // 에러 클리어
  const clearError = useCallback(() => {
    multiLoadingState.reset()
  }, [multiLoadingState])

  // 사용자 로그인 상태 변경 시 좋아요 상태 조회 - 디바운싱 적용
  useEffect(() => {
    if (user && postId) {
      // 디바운싱: 짧은 지연 후 요청 실행
      const debounceTimeout = setTimeout(() => {
        fetchLikeStatus()
      }, 100) // 100ms 디바운싱

      return () => clearTimeout(debounceTimeout)
    }
  }, [user?.id, postId]) // fetchLikeStatus 의존성 제거하여 무한 루프 방지

  // 컴포넌트 언마운트시 타임아웃 정리
  useEffect(() => {
    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [])

  return {
    // 상태
    likeCount: state.likeCount,
    isLiked: state.isLiked,
    isLoading: multiLoadingState.isAnyLoading,
    isFetching: multiLoadingState.getLoadingState('fetch').isLoading,
    isToggling: multiLoadingState.getLoadingState('toggle').isLoading,
    error: multiLoadingState.globalError,
    
    // 액션
    toggleLike,
    refreshLikeStatus: fetchLikeStatus,
    clearError,
    
    // 유틸
    canLike: !!user,
    reset: () => multiLoadingState.reset()
  }
}