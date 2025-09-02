'use client'

import { memo } from 'react'
import { FiEye, FiBookmark, FiTrash2, FiRotateCcw, FiUser, FiCalendar, FiMessageSquare, FiEdit3, FiExternalLink } from 'react-icons/fi'
import type { Post } from '@/types'

interface PostCardProps {
  post: Post
  onView: () => void
  onAction: (postId: string, action: 'delete' | 'restore' | 'pin' | 'unpin') => void
  isLoading: boolean
}

function PostCard({ post, onView, onAction, isLoading }: PostCardProps) {
  const getCategoryColor = (category: string) => {
    switch (category) {
      case '공지':
        return 'bg-red-100 text-red-800'
      case '잡담':
        return 'bg-blue-100 text-blue-800'
      case '홍보':
        return 'bg-green-100 text-green-800'
      case '건의':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const truncateContent = (content: string, maxLength: number = 150) => {
    if (content.length <= maxLength) return content
    return content.substring(0, maxLength) + '...'
  }

  const getPostUrl = (postId: string) => {
    return `/board/${postId}`
  }

  return (
    <div className={`border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow ${
      post.is_deleted ? 'bg-red-50 border-red-200' : 'bg-white'
    } ${post.is_pinned ? 'border-l-4 border-l-green-500' : ''}`}>
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {/* 헤더 정보 */}
            <div className="flex items-center space-x-2 mb-2">
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getCategoryColor(post.category)}`}>
                {post.category}
              </span>
              {post.is_pinned && (
                <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full flex items-center">
                  <FiBookmark className="w-3 h-3 mr-1" />
                  고정됨
                </span>
              )}
              {post.is_deleted && (
                <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
                  삭제됨
                </span>
              )}
            </div>

            {/* 제목 */}
            <h3 className={`text-lg font-semibold mb-2 ${
              post.is_deleted ? 'text-gray-500 line-through' : 'text-gray-900'
            }`}>
              {post.title}
            </h3>

            {/* 내용 미리보기 */}
            <p className={`text-sm mb-3 ${
              post.is_deleted ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {truncateContent(post.content)}
            </p>

            {/* 메타 정보 */}
            <div className="flex items-center space-x-4 text-sm text-gray-500">
              <div className="flex items-center">
                <FiUser className="w-4 h-4 mr-1" />
                <span>{post.author?.display_name || post.author?.name}</span>
              </div>
              <div className="flex items-center">
                <FiCalendar className="w-4 h-4 mr-1" />
                <span>{formatDate(post.created_at)}</span>
              </div>
              {post.comment_count !== undefined && (
                <div className="flex items-center">
                  <FiMessageSquare className="w-4 h-4 mr-1" />
                  <span>{post.comment_count}개 댓글</span>
                </div>
              )}
              {post.updated_at && post.updated_at !== post.created_at && (
                <div className="flex items-center">
                  <FiEdit3 className="w-4 h-4 mr-1" />
                  <span>수정됨</span>
                </div>
              )}
            </div>
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center space-x-2 ml-4">
            {/* 게시글 보기 버튼 */}
            <button
              onClick={onView}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              title="상세 보기"
            >
              <FiEye className="w-4 h-4" />
            </button>

            {/* 실제 게시글 페이지로 이동 */}
            <a
              href={getPostUrl(post.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
              title="게시글 페이지로 이동"
            >
              <FiExternalLink className="w-4 h-4" />
            </a>

            {/* 고정/고정해제 버튼 (공지사항에만) */}
            {post.category === '공지' && !post.is_deleted && (
              <button
                onClick={() => onAction(post.id, post.is_pinned ? 'unpin' : 'pin')}
                disabled={isLoading}
                className={`p-2 rounded-md transition-colors disabled:opacity-50 ${
                  post.is_pinned
                    ? 'text-green-600 hover:text-green-700 hover:bg-green-50'
                    : 'text-gray-500 hover:text-green-600 hover:bg-green-50'
                }`}
                title={post.is_pinned ? '고정 해제' : '고정하기'}
              >
                <FiBookmark className="w-4 h-4" />
              </button>
            )}

            {/* 삭제/복구 버튼 */}
            {post.is_deleted ? (
              <button
                onClick={() => onAction(post.id, 'restore')}
                disabled={isLoading}
                className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-md transition-colors disabled:opacity-50"
                title="복구"
              >
                <FiRotateCcw className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => onAction(post.id, 'delete')}
                disabled={isLoading}
                className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                title="삭제"
              >
                <FiTrash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 로딩 상태 */}
        {isLoading && (
          <div className="mt-3 flex items-center text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mr-2"></div>
            처리 중...
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(PostCard)