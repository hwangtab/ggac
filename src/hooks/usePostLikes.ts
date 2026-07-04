/**
 * 게시글 좋아요 관리 훅
 * 좋아요 토글, 상태 관리, 실시간 업데이트 제공
 */

'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { PostLikeToggleResponse } from '@/types'
import { createLogger } from '@/utils/logger'
import { useMultiLoadingState } from '@/hooks/useLoadingState'
import { fetchSessionProfile } from '@/utils/sessionProfile'

const log = createLogger('usePostLikes')

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
  /** 목록 등에서 서버가 is_liked를 이미 제공했으면 초기 조회를 생략 */
  prefetched?: boolean
  /** 상태 변경 콜백 */
  onLikeChange?: (postId: string, liked: boolean, count: number) => void
}

export function usePostLikes({
  postId,
  initialLikeCount = 0,
  initialIsLiked = false,
  prefetched = false,
  onLikeChange,
}: UsePostLikesProps) {
  const [userId, setUserId] = useState<string | null>(null)
  const [state, setState] = useState<PostLikeState>({
    likeCount: initialLikeCount,
    isLiked: initialIsLiked,
  })

  const scheduleIdle = (fn: () => void) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: 2000 })
    } else {
      setTimeout(fn, 0)
    }
  }

  // 중복 요청 방지 및 캐싱
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastFetchRef = useRef<string>('')

  // 로딩 상태 관리
  const multiLoadingState = useMultiLoadingState({
    timeout: 5000,
    enableLogging: true,
    onError: error => {
      log.error('PostLikes 작업 오류:', error)
    },
  })

  const refreshUser = useCallback(async () => {
    const session = await fetchSessionProfile()
    setUserId(session.user?.id ?? null)
    return session.user?.id ?? null
  }, [])

  // 사용자 정보 가져오기
  useEffect(() => {
    scheduleIdle(() => {
      void refreshUser().catch(authInitError => {
        log.error('auth 초기화 실패:', authInitError)
      })
    })

    const handleFocus = () => {
      void refreshUser()
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [refreshUser])

  // 좋아요 상태 초기화 및 조회 - 디바운싱 및 중복 방지 추가
  const fetchLikeStatus = useCallback(
    async (force: boolean = false) => {
      if (!userId || !postId) return

      // 중복 요청 방지 - 같은 요청이 이미 진행 중이면 무시
      const fetchKey = `${userId}-${postId}`
      if (!force && lastFetchRef.current === fetchKey) {
        log.debug('중복 요청 방지:', fetchKey)
        return
      }

      // 이전 타임아웃 클리어
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }

      lastFetchRef.current = fetchKey
      multiLoadingState.startLoading('fetch')

      try {
        log.debug('GET 요청 시작:', `/api/posts/${postId}/likes`)

        const response = await fetch(`/api/posts/${postId}/likes`)

        log.debug('GET 응답:', response.status, response.statusText)

        if (!response.ok) {
          let errorMessage = '좋아요 정보를 불러올 수 없습니다.'

          try {
            const errorData = await response.json()
            errorMessage = errorData.error || errorMessage
          } catch (parseError) {
            log.error('JSON 파싱 실패:', parseError)
            if (response.status === 404) {
              errorMessage = 'API 엔드포인트를 찾을 수 없습니다.'
            } else if (response.status >= 500) {
              errorMessage = '서버 오류가 발생했습니다.'
            }
          }

          throw new Error(errorMessage)
        }

        const json = await response.json()
        // 표준 응답 래퍼: { success, data: { like_count, is_liked } }
        const data = json?.data ?? {}
        log.debug('GET 데이터:', data)

        setState(prev => ({
          ...prev,
          likeCount: data.like_count || 0,
          isLiked: data.is_liked || false,
        }))

        multiLoadingState.finishLoading('fetch', data)
      } catch (error) {
        log.error('GET 오류:', error)
        multiLoadingState.failLoading('fetch', error as Error)
      } finally {
        // 요청 완료 후 일정 시간 후 중복 방지 키 리셋 (디바운싱)
        fetchTimeoutRef.current = setTimeout(() => {
          lastFetchRef.current = ''
        }, 2000) // 2초 후 리셋으로 증가하여 중복 요청 방지 강화
      }
    },
    [multiLoadingState, userId, postId]
  )

  // 좋아요 토글
  const toggleLike = useCallback(async () => {
    log.debug('toggleLike 시작', {
      postId,
      hasUser: !!userId,
      isToggling: multiLoadingState.getLoadingState('toggle').isLoading,
    })

    const currentUserId = userId ?? (await refreshUser())
    if (!currentUserId) {
      setState(prev => ({
        ...prev,
        error: '로그인이 필요합니다.',
      }))
      return false
    }

    if (!postId) {
      setState(prev => ({
        ...prev,
        error: '게시글 정보가 없습니다.',
      }))
      return false
    }

    // 중복 처리 방지
    if (multiLoadingState.getLoadingState('toggle').isLoading) {
      log.debug('이미 처리 중 - 요청 무시')
      return false
    }

    // Capture pre-toggle state for reliable rollback on rapid double-clicks
    const preToggleLiked = state.isLiked
    const preToggleCount = state.likeCount

    // Optimistic update - UI 즉시 업데이트
    const optimisticIsLiked = !state.isLiked
    const optimisticCount = optimisticIsLiked ? state.likeCount + 1 : state.likeCount - 1

    setState(prev => ({
      ...prev,
      isLiked: optimisticIsLiked,
      likeCount: optimisticCount,
    }))

    multiLoadingState.startLoading('toggle')

    // 부모 컴포넌트에 즉시 알림 (실시간 업데이트보다 빠른 UI 반영)
    if (onLikeChange) {
      log.debug('Optimistic update - 부모에 즉시 알림:', {
        postId,
        liked: optimisticIsLiked,
        count: optimisticCount,
      })
      onLikeChange(postId, optimisticIsLiked, optimisticCount)
    }

    try {
      const response = await fetch(`/api/posts/${postId}/likes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      log.debug('POST 응답:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      })

      if (!response.ok) {
        log.error('POST 응답 오류:', response.status)

        let errorMessage = '좋아요 처리에 실패했습니다.'

        try {
          const errorData = await response.json()
          log.error('서버 에러 응답:', errorData)
          errorMessage = errorData.error || errorData.message || errorMessage
        } catch (parseError) {
          log.error('JSON 파싱 실패:', parseError)
          if (response.status === 401) {
            errorMessage = '로그인이 필요합니다.'
          } else if (response.status === 403) {
            errorMessage = '좋아요 권한이 없습니다.'
          } else if (response.status === 404) {
            errorMessage = 'API 엔드포인트를 찾을 수 없습니다.'
          } else if (response.status >= 500) {
            errorMessage = '서버 오류가 발생했습니다.'
          }
        }

        throw new Error(errorMessage)
      }

      const successJson = await response.json()
      // 표준 응답 래퍼: { success, data: { liked, like_count, message } }
      const successData: PostLikeToggleResponse = successJson?.data
      log.debug('POST 성공:', successData)

      // 상태 업데이트
      setState(prev => ({
        ...prev,
        likeCount: successData.like_count,
        isLiked: successData.liked,
      }))

      multiLoadingState.finishLoading('toggle', successData)

      // 콜백 호출 (postId 포함)
      onLikeChange?.(postId, successData.liked, successData.like_count)

      return true
    } catch (error) {
      log.error('POST 오류:', error)

      // Optimistic update 롤백 - use pre-toggle snapshot to avoid wrong values on rapid clicks
      let errorMessage = '좋아요 처리에 실패했습니다.'
      if (error instanceof Error) {
        errorMessage = error.message
      }

      setState(prev => ({
        ...prev,
        isLiked: preToggleLiked,
        likeCount: preToggleCount,
      }))

      multiLoadingState.failLoading('toggle', errorMessage)

      // 부모 컴포넌트에 롤백 알림
      if (onLikeChange) {
        log.debug('에러 발생 - 롤백 알림:', {
          postId,
          liked: preToggleLiked,
          count: preToggleCount,
        })
        onLikeChange(postId, preToggleLiked, preToggleCount)
      }

      return false
    }
  }, [userId, refreshUser, postId, onLikeChange, state.isLiked, state.likeCount, multiLoadingState])

  // 에러 클리어
  const clearError = useCallback(() => {
    multiLoadingState.reset()
  }, [multiLoadingState])

  // 사용자 로그인 상태 변경 시 좋아요 상태 조회 - 디바운싱 적용
  useEffect(() => {
    if (!userId || !postId) return

    // 기본: 서버가 안 줬다면 조회
    let shouldFetch = !prefetched

    // prefetched가 true인 경우 서버에서 이미 정확한 데이터를 제공했으므로
    // 매우 제한적인 경우에만 재조회 수행
    if (
      !shouldFetch &&
      prefetched &&
      initialIsLiked === false &&
      initialLikeCount > 0 &&
      initialLikeCount <= 2 // 3에서 2로 줄여서 더 엄격하게 제한
    ) {
      shouldFetch = true
    }

    // prefetched이고 이미 좋아요를 눌렀거나 좋아요가 없는 경우 재조회 생략
    if (prefetched && (initialIsLiked || initialLikeCount === 0)) {
      shouldFetch = false
    }

    if (!shouldFetch) return

    // 디바운스 시간을 500ms로 증가하여 연속된 상태 변경 시 불필요한 요청 방지
    const debounceTimeout = setTimeout(() => {
      fetchLikeStatus(false) // force=false로 변경하여 중복 방지 로직 활용
    }, 500)

    return () => clearTimeout(debounceTimeout)
  }, [fetchLikeStatus, userId, postId, prefetched, initialIsLiked, initialLikeCount])

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
    canLike: !!userId,
    reset: () => multiLoadingState.reset(),
  }
}
