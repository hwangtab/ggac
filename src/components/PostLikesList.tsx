/**
 * 게시글 좋아요한 사용자 목록 컴포넌트
 * 게시글을 좋아요한 사용자들의 목록을 표시
 */

'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { FiUsers, FiHeart, FiX } from 'react-icons/fi'
import type { PostLikedUser } from '@/types'

interface PostLikesListProps {
  /** 게시글 ID */
  postId: string
  /** 좋아요 수 */
  likeCount: number
  /** 모달로 표시할지 여부 */
  isModal?: boolean
  /** 모달 닫기 콜백 */
  onClose?: () => void
  /** 클래스명 */
  className?: string
}

const PostLikesList: React.FC<PostLikesListProps> = ({
  postId,
  likeCount,
  isModal = false,
  onClose,
  className = ''
}) => {
  const [likedUsers, setLikedUsers] = useState<PostLikedUser[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  // 좋아요한 사용자 목록 조회
  const fetchLikedUsers = useCallback(async (pageNum: number = 1, append: boolean = false) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/posts/${postId}/likes?include_users=true&limit=20&offset=${(pageNum - 1) * 20}`
      )
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '좋아요 목록을 불러올 수 없습니다.')
      }

      const users = data.liked_users || []
      
      if (append) {
        setLikedUsers(prev => [...prev, ...users])
      } else {
        setLikedUsers(users)
      }

      setHasMore(users.length === 20) // 20개 미만이면 더 이상 없음
      setPage(pageNum)

    } catch (error) {
      console.error('좋아요 목록 조회 오류:', error)
      setError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [postId])

  // 더 보기
  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchLikedUsers(page + 1, true)
    }
  }, [fetchLikedUsers, page, isLoading, hasMore])

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    if (postId && likeCount > 0) {
      fetchLikedUsers()
    }
  }, [postId, likeCount, fetchLikedUsers])

  // 시간 포맷팅
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInMs = now.getTime() - date.getTime()
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))

    if (diffInDays === 0) {
      const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60))
      if (diffInHours === 0) {
        const diffInMinutes = Math.floor(diffInMs / (1000 * 60))
        return `${diffInMinutes}분 전`
      }
      return `${diffInHours}시간 전`
    } else if (diffInDays < 7) {
      return `${diffInDays}일 전`
    } else {
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    }
  }

  // 에러 상태
  if (error) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <p className="text-red-600 text-sm">{error}</p>
        <button
          onClick={() => fetchLikedUsers()}
          className="mt-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700"
        >
          다시 시도
        </button>
      </div>
    )
  }

  // 좋아요가 없는 경우
  if (likeCount === 0) {
    return (
      <div className={`p-4 text-center text-gray-500 ${className}`}>
        <FiHeart className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm">아직 좋아요가 없습니다.</p>
      </div>
    )
  }

  const content = (
    <div className={`${isModal ? '' : className}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <FiHeart className="w-5 h-5 text-red-500" />
          <h3 className="font-semibold text-gray-900">
            좋아요 {likeCount.toLocaleString()}개
          </h3>
        </div>
        {isModal && onClose && (
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <FiX className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 사용자 목록 */}
      <div className="max-h-96 overflow-y-auto">
        {isLoading && likedUsers.length === 0 ? (
          <div className="p-4 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 text-sm mt-2">좋아요 목록을 불러오는 중...</p>
          </div>
        ) : (
          <div className="space-y-1">
            {likedUsers.map((user) => (
              <div
                key={user.user_id}
                className="flex items-center justify-between p-3 hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-primary-600 font-medium text-sm">
                      {user.display_name?.charAt(0) || user.email?.charAt(0) || '?'}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">
                      {user.display_name || '익명'}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {user.email}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-gray-500 text-xs">
                    {formatDate(user.liked_at)}
                  </p>
                </div>
              </div>
            ))}

            {/* 더 보기 버튼 */}
            {hasMore && (
              <div className="p-4 text-center border-t border-gray-100">
                <button
                  onClick={loadMore}
                  disabled={isLoading}
                  className="px-4 py-2 text-primary-600 text-sm font-medium hover:bg-primary-50 rounded-lg disabled:opacity-50"
                >
                  {isLoading ? '로딩 중...' : '더 보기'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // 모달로 표시하는 경우
  if (isModal) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-[600px] overflow-hidden">
          {content}
        </div>
      </div>
    )
  }

  // 일반 컴포넌트로 표시하는 경우
  return content
}

/**
 * 좋아요 수를 클릭할 수 있는 텍스트 컴포넌트
 */
interface PostLikesCountProps {
  /** 게시글 ID */
  postId: string
  /** 좋아요 수 */
  likeCount: number
  /** 클래스명 */
  className?: string
}

export const PostLikesCount: React.FC<PostLikesCountProps> = ({
  postId,
  likeCount,
  className = ''
}) => {
  const [showModal, setShowModal] = useState(false)

  if (likeCount === 0) return null

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`text-gray-600 text-sm hover:text-primary-600 hover:underline ${className}`}
      >
        좋아요 {likeCount.toLocaleString()}개
      </button>

      {showModal && (
        <PostLikesList
          postId={postId}
          likeCount={likeCount}
          isModal
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}

export default PostLikesList