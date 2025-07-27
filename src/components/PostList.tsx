import React, { useState, useEffect, memo } from 'react'

import { useRouter } from 'next/navigation'

import { supabase } from '@/lib/supabase/client'
import { BOARD_CATEGORIES, BOARD_CATEGORY_STYLES } from '@/constants/categories'

import CommentSection from './CommentSection'
import PaginationControls from './PaginationControls'
import PostLikeButton from './PostLikeButton'

import type { Post } from '@/types'

interface PostListProps {
  posts: Post[]
  currentUserId?: string
  isMember: boolean
  // 페이지네이션 props
  currentPage?: number
  totalPages?: number
  totalCount?: number
  pageSize?: number
  loading?: boolean
  onPageChange?: (page: number) => void
  onCategoryChange?: (category: string) => void
}

interface Profile {
  id: string
  display_name: string
}

const PostList: React.FC<PostListProps> = ({ 
  posts, 
  currentUserId, 
  isMember,
  currentPage = 1,
  totalPages = 1,
  totalCount = 0,
  pageSize = 10,
  loading = false,
  onPageChange,
  onCategoryChange
}) => {
  const [profiles, setProfiles] = useState<Record<string, string>>({})
  const [selectedCategory, setSelectedCategory] = useState<string>('전체')
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set())
  const [localPosts, setLocalPosts] = useState<Post[]>(posts)
  const router = useRouter()


  // posts prop이 변경될 때 localPosts 동기화
  useEffect(() => {
    setLocalPosts(posts)
  }, [posts])

  useEffect(() => {
    const fetchProfiles = async () => {
      const authorIds = Array.from(new Set(localPosts.map(post => post.author_id)))
      if (authorIds.length === 0) return

      const { data, error } = await supabase
        .from('member_profiles')
        .select('id, display_name')
        .in('id', authorIds)

      if (data && !error) {
        const profileMap: Record<string, string> = {}
        data.forEach((profile: any) => {
          profileMap[profile.id] = profile.display_name || 'Unknown'
        })
        setProfiles(profileMap)
      }
    }

    fetchProfiles()
  }, [localPosts])

  // 로컬 상태를 사용하여 즉시 UI 업데이트
  const displayPosts = localPosts

  // 개별 게시글의 좋아요 상태 업데이트 핸들러
  const handleLikeChange = (postId: string, liked: boolean, count: number) => {
    setLocalPosts(prevPosts => 
      prevPosts.map(post => 
        post.id === postId 
          ? { ...post, like_count: count, is_liked: liked }
          : post
      )
    )
  }

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category)
    if (onCategoryChange) {
      onCategoryChange(category)
    }
  }

  const getCategoryBadgeColor = (category: string) => {
    return BOARD_CATEGORY_STYLES[category as keyof typeof BOARD_CATEGORY_STYLES] || 'bg-gray-100 text-gray-800'
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
          {BOARD_CATEGORIES.map((category) => (
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
          {[...Array(pageSize)].map((_, index) => (
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
            {selectedCategory === '전체' ? '게시글이 없습니다.' : `${selectedCategory} 게시글이 없습니다.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayPosts.map((post) => (
            <div key={post.id} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryBadgeColor(post.category)}`}>
                    {post.category}
                  </span>
                  {post.category === '공지' && (
                    <span className="text-red-600 text-xs font-bold">📌</span>
                  )}
                </div>
                <h3 
                  className="text-xl font-bold text-gray-900 mb-2 cursor-pointer hover:text-primary-600 transition-colors"
                  onClick={() => router.push(`/board/${post.id}`)}
                >
                  {post.title}
                </h3>
                {isMember ? (
                  <div 
                    className="text-gray-700 mt-2 leading-relaxed cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                    onClick={() => router.push(`/board/${post.id}`)}
                  >
                    <p className="line-clamp-3">
                      {post.content.length > 150 ? `${post.content.substring(0, 150)}...` : post.content}
                    </p>
                    {post.content.length > 150 && (
                      <span className="text-primary-600 text-sm mt-1 inline-block">더 보기</span>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 p-4 bg-gray-100 rounded-md text-center">
                    <p className="text-gray-600 text-sm">
                      🔒 조합원 승인 후 내용을 볼 수 있습니다
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                  <span className="text-sm text-gray-600">
                    작성자: <span className="font-medium">{profiles[post.author_id] || 'Loading...'}</span>
                  </span>
                  <div className="flex items-center gap-4">
                    {isMember && (
                      <>
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
                        <button
                          onClick={() => toggleComments(post.id)}
                          className="text-sm text-gray-500 hover:text-primary-600 transition-colors"
                        >
                          💬 댓글 {expandedPosts.has(post.id) ? '접기' : '보기'}
                        </button>
                      </>
                    )}
                    <span className="text-sm text-gray-500">
                      {new Date(post.created_at).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
                
                {isMember && expandedPosts.has(post.id) && (
                  <CommentSection 
                    postId={post.id} 
                    currentUserId={currentUserId}
                    isMember={isMember}
                  />
                )}
              </div>
            ))}
          </div>
        )
      }
      
      {/* 페이지네이션 컨트롤 */}
      {onPageChange && totalPages > 1 && (
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={pageSize}
          onPageChange={onPageChange}
          loading={loading}
          className="mt-8"
        />
      )}
    </div>
  )
}

export default memo(PostList)
