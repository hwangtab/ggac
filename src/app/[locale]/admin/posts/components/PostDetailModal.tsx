'use client'

import {
  FiX,
  FiBookmark,
  FiTrash2,
  FiRotateCcw,
  FiUser,
  FiCalendar,
  FiMessageSquare,
  FiEdit3,
  FiExternalLink,
  FiAlertCircle,
} from 'react-icons/fi'
import { useEffect, useRef, useState } from 'react'
import type { Post } from '@/types'
import { useDialogA11y } from '@/hooks/useDialogA11y'

interface PostDetailModalProps {
  post: Post
  isOpen: boolean
  onClose: () => void
  onAction: (postId: string, action: 'delete' | 'restore' | 'pin' | 'unpin') => void
  isLoading: boolean
}

export default function PostDetailModal({
  post,
  isOpen,
  onClose,
  onAction,
  isLoading,
}: PostDetailModalProps) {
  const [confirmAction, setConfirmAction] = useState<{ action: string; title: string } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useDialogA11y({ containerRef: dialogRef, onClose, isOpen })

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  if (!isOpen) return null

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
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatContent = (content: string) => {
    // 간단한 줄바꿈 처리
    return content.split('\n').map((line, index) => (
      <p key={index} className="mb-2 last:mb-0">
        {line || '\u00A0'} {/* 빈 줄은 공백으로 표시 */}
      </p>
    ))
  }

  const getPostUrl = (postId: string) => {
    return `/board/${postId}`
  }

  const handleAction = (action: 'delete' | 'restore' | 'pin' | 'unpin') => {
    const actionTitles = {
      delete: '삭제',
      restore: '복구',
      pin: '고정',
      unpin: '고정 해제',
    }

    setConfirmAction({ action, title: actionTitles[action] })
  }

  const confirmActionHandler = () => {
    if (confirmAction) {
      onAction(post.id, confirmAction.action as any)
      setConfirmAction(null)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      role="presentation"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-detail-modal-title"
        tabIndex={-1}
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-2">
            <h2 id="post-detail-modal-title" className="text-xl font-semibold text-gray-900">
              게시글 상세
            </h2>
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${getCategoryColor(post.category)}`}
            >
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
          <button
            type="button"
            onClick={onClose}
            aria-label="모달 닫기"
            className="p-2 hover:bg-gray-100 rounded-md transition-colors"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        {/* 콘텐츠 */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          <div className="space-y-6">
            {/* 게시글 메타 정보 */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center">
                  <FiUser className="w-4 h-4 text-gray-500 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">작성자</p>
                    <p className="text-sm font-medium text-gray-900">
                      {post.author?.display_name || post.author?.name}
                    </p>
                    <p className="text-xs text-gray-500">{post.author?.email}</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <FiCalendar className="w-4 h-4 text-gray-500 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">작성일</p>
                    <p className="text-sm font-medium text-gray-900">
                      {formatDate(post.created_at)}
                    </p>
                    {post.updated_at && post.updated_at !== post.created_at && (
                      <p className="text-xs text-gray-500">수정: {formatDate(post.updated_at)}</p>
                    )}
                  </div>
                </div>
                {post.comment_count !== undefined && (
                  <div className="flex items-center">
                    <FiMessageSquare className="w-4 h-4 text-gray-500 mr-2" />
                    <div>
                      <p className="text-sm text-gray-600">댓글 수</p>
                      <p className="text-sm font-medium text-gray-900">{post.comment_count}개</p>
                    </div>
                  </div>
                )}
                {post.is_pinned && post.pinned_at && (
                  <div className="flex items-center">
                    <FiBookmark className="w-4 h-4 text-green-500 mr-2" />
                    <div>
                      <p className="text-sm text-gray-600">고정일</p>
                      <p className="text-sm font-medium text-gray-900">
                        {formatDate(post.pinned_at)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 게시글 제목 */}
            <div>
              <h3
                className={`text-2xl font-bold mb-2 ${
                  post.is_deleted ? 'text-gray-500 line-through' : 'text-gray-900'
                }`}
              >
                {post.title}
              </h3>
            </div>

            {/* 게시글 내용 */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">내용</h4>
              <div
                className={`prose max-w-none ${
                  post.is_deleted ? 'text-gray-400' : 'text-gray-700'
                }`}
              >
                {formatContent(post.content)}
              </div>
            </div>

            {/* 경고 메시지 (삭제된 게시글) */}
            {post.is_deleted && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex">
                  <FiAlertCircle className="w-5 h-5 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-red-800">삭제된 게시글</h4>
                    <p className="text-sm text-red-700 mt-1">
                      이 게시글은 삭제되어 일반 사용자에게 보이지 않습니다. 복구하시겠습니까?
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200">
          <div className="flex items-center space-x-2">
            <a
              href={getPostUrl(post.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center"
            >
              <FiExternalLink className="w-4 h-4 mr-2" />
              게시글 페이지로 이동
            </a>
          </div>

          <div className="flex items-center space-x-3">
            {/* 고정/고정해제 버튼 (공지사항에만) */}
            {post.category === '공지' && !post.is_deleted && (
              <button
                onClick={() => handleAction(post.is_pinned ? 'unpin' : 'pin')}
                disabled={isLoading}
                className={`px-4 py-2 rounded-md disabled:opacity-50 flex items-center ${
                  post.is_pinned
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-600 text-white hover:bg-gray-700'
                }`}
              >
                <FiBookmark className="w-4 h-4 mr-2" />
                {post.is_pinned ? '고정 해제' : '고정하기'}
              </button>
            )}

            {/* 삭제/복구 버튼 */}
            {post.is_deleted ? (
              <button
                onClick={() => handleAction('restore')}
                disabled={isLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center"
              >
                <FiRotateCcw className="w-4 h-4 mr-2" />
                복구
              </button>
            ) : (
              <button
                onClick={() => handleAction('delete')}
                disabled={isLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center"
              >
                <FiTrash2 className="w-4 h-4 mr-2" />
                삭제
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              닫기
            </button>
          </div>
        </div>
      </div>

      {/* 확인 모달 */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-60">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <FiAlertCircle className="w-6 h-6 text-yellow-500 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">확인</h3>
              </div>
              <p className="text-gray-600 mb-6">이 게시글을 {confirmAction.title}하시겠습니까?</p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  취소
                </button>
                <button
                  onClick={confirmActionHandler}
                  disabled={isLoading}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {isLoading ? '처리 중...' : '확인'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
