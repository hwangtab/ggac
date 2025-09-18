import React, { useState, useEffect, memo, useCallback } from 'react'

import { useRouter } from 'next/navigation'

import { BOARD_CATEGORIES, BOARD_CATEGORY_STYLES } from '@/constants/categories'

import CommentSection from './CommentSection'
// import PaginationControls from './PaginationControls' // 키셋 페이지네이션으로 대체
import PostLikeButton from './PostLikeButton'
import PostAttachmentPreview from './PostAttachmentPreview'
import { FiImage, FiFile, FiVideo, FiMusic } from 'react-icons/fi'
import { createTextPreview, stripHtmlTags } from '@/utils/textUtils'

import type { Post } from '@/types'

interface PostListProps {
  posts: Post[]
  currentUserId?: string
  isMember: boolean
  // 키셋 페이지네이션 props
  hasNext?: boolean
  hasPrev?: boolean
  loading?: boolean
  onNextPage?: () => void
  onPrevPage?: () => void
  onCategoryChange?: (category: string) => void
}

// author display name is provided by API; avoid extra client fetches for speed

const PostList: React.FC<PostListProps> = ({
  posts,
  currentUserId,
  isMember,
  hasNext = false,
  hasPrev = false,
  loading = false,
  onNextPage,
  onPrevPage,
  onCategoryChange,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('전체')
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set())
  const [localPosts, setLocalPosts] = useState<Post[]>(posts)
  const router = useRouter()

  // posts prop이 변경될 때 localPosts 동기화
  useEffect(() => {
    setLocalPosts(posts)
  }, [posts])

  // Removed client-side profile fetching; use post.author?.display_name from API

  // 로컬 상태를 사용하여 즉시 UI 업데이트
  const displayPosts = localPosts

  // 개별 게시글의 좋아요 상태 업데이트 핸들러
  const handleLikeChange = useCallback((postId: string, liked: boolean, count: number) => {
    setLocalPosts(prevPosts =>
      prevPosts.map(post =>
        post.id === postId ? { ...post, like_count: count, is_liked: liked } : post
      )
    )
  }, [])

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category)
    if (onCategoryChange) {
      onCategoryChange(category)
    }
  }

  const getCategoryBadgeColor = (category: string) => {
    return (
      BOARD_CATEGORY_STYLES[category as keyof typeof BOARD_CATEGORY_STYLES] ||
      'bg-gray-100 text-gray-800'
    )
  }

  const toggleComments = (postId: string) => {
    setExpandedPosts(prev => {
      const newSet = new Set(prev)
      if (newSet.has(postId)) {
        newSet.delete(postId)
      } else {
        newSet.add(postId)
      }
      return newSet
    })
  }

  return (
    <div className="mt-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <h2 className="text-2xl font-semibold mb-4 sm:mb-0">게시글 목록</h2>
        <div className="flex flex-wrap gap-2">
          {BOARD_CATEGORIES.map(category => (
            <button
              key={category}
              onClick={() => handleCategoryChange(category)}
              disabled={loading}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === category
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {/* 로딩 스켈레톤 */}
          {[...Array(5)].map((_, index) => (
            <div key={index} className="bg-white p-6 rounded-lg shadow-md animate-pulse">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-12 h-5 bg-gray-200 rounded-full"></div>
              </div>
              <div className="w-3/4 h-6 bg-gray-200 rounded mb-2"></div>
              <div className="w-full h-20 bg-gray-200 rounded mb-4"></div>
              <div className="flex items-center justify-between">
                <div className="w-24 h-4 bg-gray-200 rounded"></div>
                <div className="w-32 h-4 bg-gray-200 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      ) : displayPosts.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500">
            {selectedCategory === '전체'
              ? '게시글이 없습니다.'
              : `${selectedCategory} 게시글이 없습니다.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayPosts.map(post => (
            <div
              key={post.id}
              className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryBadgeColor(post.category)}`}
                >
                  {post.category}
                </span>
                {post.category === '공지' && (
                  <span className="text-red-600 text-xs font-bold">📌</span>
                )}
              </div>
              <h3
                className="text-2xl font-bold font-post text-gray-700 mb-2 cursor-pointer hover:text-primary-600 transition-colors"
                onClick={() => router.push(`/board/${post.id}`)}
              >
                {post.title}
              </h3>
              {/* 게시물 내용은 모든 사용자가 볼 수 있음 */}
              <div
                className="text-gray-700 mt-2 leading-relaxed cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                onClick={() => router.push(`/board/${post.id}`)}
              >
                {(() => {
                  const serverPreview = (post as any).content_preview as string | undefined
                  const hasImages = (post as any).preview_has_images as boolean | undefined
                  const imageCount = (post as any).preview_image_count as number | undefined
                  const fallback = serverPreview ? null : createTextPreview(post.content, 150)
                  const rawText = serverPreview ?? fallback!.text
                  const text = serverPreview ? stripHtmlTags(serverPreview) : rawText
                  const truncated = fallback ? fallback.isTruncated : text.length > 150
                  const showImages = hasImages ?? fallback!.hasImages
                  const imgCount = imageCount ?? fallback!.imageCount
                  return (
                    <>
                      <p className="line-clamp-3">{text}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {truncated && (
                          <span className="text-primary-600 text-sm inline-block">더 보기</span>
                        )}
                        {showImages && (
                          <span className="text-blue-600 text-xs flex items-center gap-1">
                            <FiImage className="w-3 h-3" />
                            이미지 {imgCount}
                          </span>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-gray-600">
                    작성자:{' '}
                    <span className="font-medium">{post.author?.display_name || '알 수 없음'}</span>
                  </span>
                  <PostAttachmentPreview postId={post.id} stats={post.attachments_stats as any} />
                </div>
                <div className="flex items-center gap-4">
                  {/* 좋아요 버튼은 조합원만 */}
                  {isMember && (
                    <PostLikeButton
                      postId={post.id}
                      initialLikeCount={post.like_count || 0}
                      initialIsLiked={post.is_liked || false}
                      size="sm"
                      variant="minimal"
                      showCount={true}
                      showLabel={false}
                      onLikeChange={handleLikeChange}
                    />
                  )}
                  {/* 댓글 보기 버튼은 모든 사용자 */}
                  <button
                    onClick={() => toggleComments(post.id)}
                    className="text-sm text-gray-500 hover:text-primary-600 transition-colors"
                  >
                    💬 댓글 {expandedPosts.has(post.id) ? '접기' : '보기'}
                  </button>
                  <span className="text-sm text-gray-500">
                    {new Date(post.created_at).toLocaleDateString('ko-KR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              {expandedPosts.has(post.id) && (
                <CommentSection
                  postId={post.id}
                  currentUserId={currentUserId}
                  isMember={isMember}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* 키셋 페이지네이션 컨트롤 */}
      {(hasPrev || hasNext) && (
        <div className="mt-8 flex justify-between items-center">
          <button
            onClick={onPrevPage}
            disabled={!hasPrev || loading}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              hasPrev && !loading
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            ← 이전 페이지
          </button>

          <span className="text-gray-600">{loading ? '로딩 중...' : '더 많은 게시글'}</span>

          <button
            onClick={onNextPage}
            disabled={!hasNext || loading}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              hasNext && !loading
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            다음 페이지 →
          </button>
        </div>
      )}
    </div>
  )
}

export default memo(PostList)
