/**
 * 게시글 좋아요 버튼 컴포넌트
 * 좋아요 토글 기능과 애니메이션 효과 제공
 */

'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { FiHeart } from 'react-icons/fi'
import { FaHeart } from 'react-icons/fa'
import { usePostLikes } from '@/hooks/usePostLikes'

interface PostLikeButtonProps {
  /** 게시글 ID */
  postId: string
  /** 초기 좋아요 수 */
  initialLikeCount?: number
  /** 초기 좋아요 상태 */
  initialIsLiked?: boolean
  /** 버튼 크기 */
  size?: 'sm' | 'md' | 'lg'
  /** 스타일 변형 */
  variant?: 'default' | 'minimal' | 'card'
  /** 좋아요 수 표시 여부 */
  showCount?: boolean
  /** 텍스트 라벨 표시 여부 */
  showLabel?: boolean
  /** 클래스명 */
  className?: string
  /** 상태 변경 콜백 */
  onLikeChange?: (postId: string, liked: boolean, count: number) => void
  /** 클릭 이벤트 콜백 */
  onClick?: () => void
}

const PostLikeButton: React.FC<PostLikeButtonProps> = ({
  postId,
  initialLikeCount = 0,
  initialIsLiked = false,
  size = 'md',
  variant = 'default',
  showCount = true,
  showLabel = false,
  className = '',
  onLikeChange,
  onClick,
}) => {
  const [isAnimating, setIsAnimating] = useState(false)
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const { likeCount, isLiked, isLoading, error, toggleLike, clearError, canLike } = usePostLikes({
    postId,
    initialLikeCount,
    initialIsLiked,
    prefetched: true,
    onLikeChange,
  })

  // 좋아요 버튼 클릭 처리
  const handleClick = useCallback(
    async (event: React.MouseEvent) => {
      // 이벤트 기본 동작 방지 (form submit 등)
      event.preventDefault()
      event.stopPropagation()

      if (!canLike) {
        return
      }

      if (isLoading || isAnimating) {
        return
      }

      setIsAnimating(true)

      try {
        const success = await toggleLike()

        if (success) {
          onClick?.()
        } else {
          setIsAnimating(false)
        }

        if (error) {
          console.error('[PostLikeButton] 에러:', error)
          clearError()
        }
      } catch (err) {
        console.error('[PostLikeButton] 처리 중 오류:', err)
        setIsAnimating(false)
      } finally {
        // 기존 타이머가 있다면 취소
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current)
        }

        // 애니메이션 유지 시간 (300ms)
        animationTimeoutRef.current = setTimeout(() => {
          setIsAnimating(false)
          animationTimeoutRef.current = null
        }, 300)
      }
    },
    [canLike, isLoading, isAnimating, toggleLike, onClick, error, clearError]
  )

  // 크기별 스타일
  const sizeClasses = {
    sm: {
      button: 'p-1',
      icon: 'w-4 h-4',
      text: 'text-xs',
      gap: 'gap-1',
    },
    md: {
      button: 'p-2',
      icon: 'w-5 h-5',
      text: 'text-sm',
      gap: 'gap-2',
    },
    lg: {
      button: 'p-3',
      icon: 'w-6 h-6',
      text: 'text-base',
      gap: 'gap-2',
    },
  }

  // 변형별 스타일
  const variantClasses = {
    default: {
      button: `
        flex items-center ${sizeClasses[size].gap} rounded-lg border transition-all duration-200
        ${
          isLiked
            ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-red-200'
        }
        ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}
        ${isAnimating ? 'scale-110' : ''}
      `,
      icon: isLiked ? 'text-red-500' : 'text-gray-500',
      count: isLiked ? 'text-red-600' : 'text-gray-600',
    },
    minimal: {
      button: `
        flex items-center ${sizeClasses[size].gap} transition-all duration-200
        ${isLiked ? 'text-red-500' : 'text-gray-500 hover:text-red-400'}
        ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
        ${isAnimating ? 'scale-110' : ''}
      `,
      icon: isLiked ? 'text-red-500' : 'text-gray-500',
      count: isLiked ? 'text-red-500' : 'text-gray-600',
    },
    card: {
      button: `
        flex items-center ${sizeClasses[size].gap} rounded-full px-3 py-1 transition-all duration-200
        ${
          isLiked
            ? 'bg-red-500 text-white'
            : 'bg-white border border-gray-300 text-gray-600 hover:bg-red-50 hover:border-red-300'
        }
        ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}
        ${isAnimating ? 'scale-110' : ''}
      `,
      icon: isLiked ? 'text-white' : 'text-gray-600',
      count: isLiked ? 'text-white' : 'text-gray-600',
    },
  }

  const currentVariant = variantClasses[variant]
  const currentSize = sizeClasses[size]

  // 에러 메시지 자동 사라짐 (3초 후)
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        clearError()
      }, 3000)

      return () => clearTimeout(timer)
    }
  }, [error, clearError])

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current)
        animationTimeoutRef.current = null
      }
    }
  }, [])

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading || !canLike || isAnimating}
      className={`relative ${currentVariant.button} ${currentSize.button} ${className}`}
      title={!canLike ? '로그인이 필요합니다' : isLiked ? '좋아요 취소' : '좋아요'}
      aria-label={`좋아요 ${likeCount || 0}개${isLiked ? ' (좋아요 누름)' : ''}`}
    >
      {/* 하트 아이콘 */}
      <span className={`${currentVariant.icon} transition-all duration-200`}>
        {isLiked ? (
          <FaHeart className={`${currentSize.icon} ${isAnimating ? 'animate-pulse' : ''}`} />
        ) : (
          <FiHeart className={currentSize.icon} />
        )}
      </span>

      {/* 좋아요 수 */}
      {showCount && (
        <span className={`${currentVariant.count} ${currentSize.text} font-medium`}>
          {(likeCount || 0).toLocaleString()}
        </span>
      )}

      {/* 텍스트 라벨 */}
      {showLabel && (
        <span className={`${currentVariant.count} ${currentSize.text}`}>
          {isLiked ? '좋아요 취소' : '좋아요'}
        </span>
      )}

      {/* 로딩 표시 */}
      {isLoading && (
        <span className="ml-1">
          <div
            className={`animate-spin rounded-full border-2 border-gray-300 border-t-red-500 ${
              size === 'sm' ? 'w-3 h-3' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5'
            }`}
          ></div>
        </span>
      )}

      {/* 에러 상태 표시 (토스트 형태로 간단히) */}
      {error && (
        <div className="absolute top-full left-0 mt-1 px-2 py-1 bg-red-100 border border-red-300 rounded text-xs text-red-700 whitespace-nowrap z-10 shadow-sm">
          {error}
        </div>
      )}
    </button>
  )
}

export default PostLikeButton
