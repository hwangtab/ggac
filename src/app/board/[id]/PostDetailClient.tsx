'use client'

import { supabase } from '../../../lib/supabase/client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import CommentSection from '../../../components/CommentSection'
import PostLikeButton from '../../../components/PostLikeButton'
import PostAttachmentsDisplay from '../../../components/PostAttachmentsDisplay'
import PostContentRenderer from '@/components/PostContentRenderer'
import type { MemberProfile } from '@/types'

interface Post {
  id: string
  title: string
  content: string
  content_format?: string
  category: string
  author_id: string
  created_at: string
  view_count?: number
  like_count?: number
  is_liked?: boolean
}

interface Profile {
  id: string
  display_name: string
  profile_image_url?: string
}

interface PostDetailClientProps {
  postId: string
  initialData: {
    post: Post
    comments: any[]
    attachments: any[]
    author: { display_name: string } | null
  }
}

export default function PostDetailClient({ postId, initialData }: PostDetailClientProps) {
  const initialPost = useMemo<Post | null>(() => {
    if (!initialData?.post) return null
    const detail = initialData.post
    return {
      id: detail.id,
      title: detail.title,
      content: detail.content || '',
      content_format: detail.content_format,
      category: detail.category,
      author_id: detail.author_id,
      created_at: detail.created_at,
      like_count: detail.like_count,
      is_liked: detail.is_liked,
      view_count: detail.view_count,
    }
  }, [initialData])

  const [post, setPost] = useState<Post | null>(initialPost)
  const [initialComments, setInitialComments] = useState<any[]>(
    initialData.comments?.slice(0, 20) || []
  )
  const [commentsPage, setCommentsPage] = useState(1)
  const [hasMoreComments, setHasMoreComments] = useState((initialData.comments?.length || 0) >= 20)
  const [commentsCursor, setCommentsCursor] = useState<string | null>(() => {
    const comments = initialData.comments || []
    if (comments.length === 0) return null
    const last = comments[comments.length - 1]
    return encodeURIComponent(`${last.created_at}|${last.id}`)
  })
  const [initialAttachments] = useState<any[]>(initialData.attachments || [])
  const [authorProfile] = useState<Profile | null>(() =>
    initialData.author
      ? { id: initialData.post.author_id, display_name: initialData.author.display_name }
      : { id: initialData.post.author_id, display_name: '알 수 없음' }
  )
  const [user, setUser] = useState<any>(null)
  const [isMember, setIsMember] = useState<boolean>(false)
  const [authLoading, setAuthLoading] = useState<boolean>(true) // 인증 상태 확인 중
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // 조합원 상태 확인 함수를 별도로 분리
  const checkMemberStatus = async (currentUser: any) => {
    if (!currentUser) {
      console.log('🔍 [PostDetailClient] No current user')
      setIsMember(false)
      return
    }

    console.log('🔍 [PostDetailClient] Checking member status for user:', currentUser.id)

    try {
      const { data: profile, error: profileError } = await supabase
        .from('member_profiles')
        .select('registration_status, is_active')
        .eq('id', currentUser.id)
        .single()

      if (profileError) {
        console.error('❌ [PostDetailClient] Error fetching profile:', profileError)
        setIsMember(false)
      } else if (profile) {
        const isApprovedMember =
          (profile as MemberProfile).registration_status === 'approved' &&
          (profile as MemberProfile).is_active
        console.log('📋 [PostDetailClient] Profile data:', profile)
        console.log(
          `✅ [PostDetailClient] Member status: ${isApprovedMember ? 'APPROVED' : 'NOT_APPROVED'}`
        )
        setIsMember(isApprovedMember)
      } else {
        console.warn('⚠️ [PostDetailClient] No profile found for user')
        setIsMember(false)
      }
    } catch (error) {
      console.error('❌ [PostDetailClient] Exception while checking member status:', error)
      setIsMember(false)
    }
  }

  // Helper: schedule at idle or next tick
  const scheduleIdle = (fn: () => void) => {
    if (typeof (window as any).requestIdleCallback === 'function') {
      ;(window as any).requestIdleCallback(fn, { timeout: 1500 })
    } else {
      setTimeout(fn, 0)
    }
  }

  useEffect(() => {
    let isMounted = true

    const hydrateUserState = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!isMounted) return
        const currentUser = session?.user || null
        setUser(currentUser)
        await checkMemberStatus(currentUser)

        if (currentUser) {
          try {
            const res = await fetch(`/api/posts/${postId}/user-data?user_id=${currentUser.id}`)
            if (res.ok) {
              const userData = await res.json()
              if (userData.success) {
                setPost(prev =>
                  prev ? { ...prev, is_liked: userData.data.is_liked ?? prev.is_liked } : prev
                )
              }
            }
          } catch {
            // ignore
          }
        }
      } catch (e) {
        console.warn('[PostDetail] auth check failed:', e)
      } finally {
        if (isMounted) {
          setAuthLoading(false)
        }
      }
    }

    const incrementViewCount = async () => {
      try {
        const lastViewTime = localStorage.getItem(`post_view_${postId}`)
        const now = Date.now()
        if (!lastViewTime || now - parseInt(lastViewTime) > 10 * 60 * 1000) {
          const viewResponse = await fetch(`/api/posts/${postId}/view`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-last-view-time': lastViewTime || '0',
            },
          })
          if (viewResponse.ok) {
            const viewData = await viewResponse.json()
            setPost(prev => (prev ? { ...prev, view_count: viewData.view_count } : prev))
            localStorage.setItem(`post_view_${postId}`, now.toString())
          }
        }
      } catch (viewError) {
        console.warn('[PostDetail] Failed to update view count:', viewError)
      }
    }

    scheduleIdle(hydrateUserState)
    scheduleIdle(incrementViewCount)

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const newUser = session?.user || null
      setUser(newUser)

      if (!newUser) {
        setIsMember(false)
        setPost(prev => (prev ? { ...prev, is_liked: false } : prev))
      } else {
        await checkMemberStatus(newUser)
        try {
          const res = await fetch(`/api/posts/${postId}/user-data?user_id=${newUser.id}`)
          if (res.ok) {
            const userData = await res.json()
            if (userData.success) {
              setPost(prev =>
                prev ? { ...prev, is_liked: userData.data.is_liked ?? prev.is_liked } : prev
              )
            }
          }
        } catch {}
      }
    })

    return () => {
      isMounted = false
      authListener?.subscription.unsubscribe()
    }
  }, [postId])

  // 댓글 더보기 로드
  const loadMoreComments = async () => {
    try {
      const nextPage = commentsPage + 1
      const resp = await fetch(
        `/api/posts/${postId}/comments-list?limit=20${commentsCursor ? `&cursor=${commentsCursor}` : ''}`,
        { cache: 'no-store' }
      )
      if (resp.ok) {
        const data = await resp.json()
        const extra = (data?.data?.comments as any[]) || []
        setInitialComments(prev => [...prev, ...extra])
        setCommentsPage(nextPage)
        setHasMoreComments(!!data?.data?.has_next)
        setCommentsCursor(data?.data?.next_cursor || null)
      }
    } catch {}
  }

  const handleDeletePost = async () => {
    if (!post || !user || post.author_id !== user.id) return

    if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return

    const { error } = await supabase.from('posts').delete().eq('id', post.id)

    if (error) {
      alert('게시글 삭제 중 오류가 발생했습니다.')
    } else {
      alert('게시글이 삭제되었습니다.')
      router.push('/board')
    }
  }

  const handleEditPost = () => {
    if (!post || !user || post.author_id !== user.id) return
    router.push(`/board/${post.id}/edit`)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case '공지':
        return 'bg-red-100 text-red-800'
      case '잡담':
        return 'bg-blue-100 text-blue-800'
      case '홍보':
        return 'bg-green-100 text-green-800'
      case '건의':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (error || !post) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h1 className="text-2xl font-bold text-red-800 mb-4">오류</h1>
              <p className="text-red-700 mb-4">{error || '게시글을 찾을 수 없습니다.'}</p>
              <button
                onClick={() => router.push('/board')}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                게시판으로 돌아가기
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* 뒤로가기 버튼 */}
          <div className="mb-6">
            <button
              onClick={() => router.push('/board')}
              className="text-gray-600 hover:text-gray-800 transition-colors flex items-center"
            >
              ← 게시판으로 돌아가기
            </button>
          </div>

          {/* 비로그인/비조합원 사용자 안내 - 인증 확인 완료 후에만 표시 */}
          {!authLoading && !user && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-800 mb-2">
                <strong>안내:</strong> 게시물을 읽어볼 수 있지만, 댓글 작성과 좋아요는 조합원만
                가능합니다.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => router.push('/login')}
                  className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition-colors"
                >
                  로그인
                </button>
                <button
                  onClick={() => router.push('/signup')}
                  className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 transition-colors"
                >
                  조합원 가입
                </button>
              </div>
            </div>
          )}

          {!authLoading && !isMember && user && (
            <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-yellow-800">
                <strong>알림:</strong> 조합원 승인 대기 중입니다. 승인 후 댓글 작성과 좋아요가
                가능합니다.
              </p>
            </div>
          )}

          {/* 게시글 내용 */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {/* 게시글 헤더 */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getCategoryColor(post.category)}`}
                >
                  {post.category}
                </span>
                {user && post.author_id === user.id && (
                  <div className="flex space-x-2">
                    <button
                      onClick={handleEditPost}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      수정
                    </button>
                    <button
                      onClick={handleDeletePost}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>

              <h1 className="text-3xl font-bold font-post text-gray-700 mb-4">{post.title}</h1>

              <div className="flex items-center space-x-4 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  {authorProfile?.profile_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={authorProfile.profile_image_url}
                      alt={authorProfile.display_name}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                      <span className="text-gray-600 text-sm">
                        {authorProfile?.display_name?.charAt(0) || '?'}
                      </span>
                    </div>
                  )}
                  <span className="font-medium">{authorProfile?.display_name || '알 수 없음'}</span>
                </div>
                <span>•</span>
                <span>{formatDate(post.created_at)}</span>
                <span>•</span>
                <div className="flex items-center space-x-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                  <span>{post.view_count || 0}</span>
                </div>
                <span>•</span>
                <PostLikeButton
                  postId={post.id}
                  initialLikeCount={post.like_count || 0}
                  initialIsLiked={post.is_liked || false}
                  size="sm"
                  variant="minimal"
                  showCount={true}
                  showLabel={false}
                  onLikeChange={(postId, liked, count) => {
                    setPost(prev => (prev ? { ...prev, like_count: count, is_liked: liked } : prev))
                  }}
                />
              </div>
            </div>

            {/* 게시글 본문 */}
            <div className="p-6">
              <div className="prose max-w-none">
                <PostContentRenderer
                  content={post.content}
                  contentFormat={(post.content_format as 'plain' | 'html' | 'markdown') || 'plain'}
                  className="text-gray-800 leading-relaxed"
                />
              </div>
            </div>

            {/* 첨부파일 */}
            <div className="px-6 pb-6">
              <PostAttachmentsDisplay postId={post.id} attachments={initialAttachments} />
            </div>
          </div>

          {/* 댓글 섹션 */}
          <div className="mt-8">
            <CommentSection
              postId={post.id}
              currentUserId={user?.id}
              isMember={isMember}
              initialComments={initialComments}
            />
            {hasMoreComments && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={loadMoreComments}
                  className="px-4 py-2 text-sm rounded-lg border bg-white hover:bg-gray-50"
                >
                  댓글 더보기
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
