/**
 * 댓글 좋아요 버튼 컴포넌트
 * 댓글 좋아요 토글 기능과 애니메이션 효과 제공
 */

'use client'

import React, { useState, useCallback } from 'react'
import { FiHeart } from 'react-icons/fi'
import { FaHeart } from 'react-icons/fa'
import { useCommentLikes } from '@/hooks/useCommentLikes'

interface CommentLikeButtonProps {
  /** 댓글 ID */
  commentId: string
  /** 초기 좋아요 수 */
  initialLikeCount?: number
  /** 초기 좋아요 상태 */
  initialIsLiked?: boolean
  /** 버튼 크기 */
  size?: 'sm' | 'md'
  /** 좋아요 수 표시 여부 */
  showCount?: boolean
  /** 클래스명 */
  className?: string
  /** 상태 변경 콜백 */
  onLikeChange?: (liked: boolean, count: number) => void
}

const CommentLikeButton: React.FC<CommentLikeButtonProps> = ({
  commentId,
  initialLikeCount = 0,
  initialIsLiked = false,
  size = 'sm',
  showCount = true,
  className = '',
  onLikeChange
}) => {
  const [isAnimating, setIsAnimating] = useState(false)
  
  const {
    likeCount,
    isLiked,
    isLoading,
    error,
    toggleLike,
    clearError,
    canLike
  } = useCommentLikes({
    commentId,
    initialLikeCount,
    initialIsLiked,
    onLikeChange
  })

  // 좋아요 버튼 클릭 처리
  const handleClick = useCallback(async () => {
    if (!canLike) {
      alert('로그인이 필요합니다.')
      return
    }

    if (isLoading) return

    // 애니메이션 효과
    setIsAnimating(true)
    setTimeout(() => setIsAnimating(false), 300)

    // 좋아요 토글
    const success = await toggleLike()

    // 에러가 있으면 표시
    if (error) {
      alert(error)
      clearError()
    }
  }, [canLike, isLoading, toggleLike, error, clearError])

  // 크기별 스타일
  const sizeClasses = {
    sm: {
      button: 'p-1',
      icon: 'w-3 h-3',
      text: 'text-xs',
      gap: 'gap-1'
    },
    md: {
      button: 'p-1.5',
      icon: 'w-4 h-4',
      text: 'text-sm',
      gap: 'gap-1.5'
    }
  }

  const currentSize = sizeClasses[size]

  return (
    <button
      onClick={handleClick}
      disabled={isLoading || !canLike}
      className={`
        flex items-center ${currentSize.gap} ${currentSize.button} 
        transition-all duration-200 rounded
        ${isLiked 
          ? 'text-red-500 hover:text-red-600' 
          : 'text-gray-400 hover:text-red-400'
        }
        ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
        ${isAnimating ? 'scale-110' : ''}
        ${className}
      `}
      title={
        !canLike 
          ? '로그인이 필요합니다' 
          : isLiked 
            ? '좋아요 취소' 
            : '좋아요'
      }
      aria-label={`댓글 좋아요 ${likeCount}개${isLiked ? ' (좋아요 누름)' : ''}`}
    >
      {/* 하트 아이콘 */}
      <span className="transition-all duration-200">
        {isLiked ? (
          <FaHeart className={`${currentSize.icon} ${isAnimating ? 'animate-pulse' : ''}`} />
        ) : (
          <FiHeart className={currentSize.icon} />
        )}
      </span>

      {/* 좋아요 수 */}
      {showCount && likeCount > 0 && (
        <span className={`${currentSize.text} font-medium`}>
          {likeCount}
        </span>
      )}

      {/* 로딩 표시 */}
      {isLoading && (
        <span className="ml-1">
          <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-red-500 ${
            size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'
          }`}></div>
        </span>
      )}
    </button>
  )
}

export default CommentLikeButton