'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase/client'
import PostList from '../../components/PostList'
import type { MemberProfile, Post } from '@/types'

interface InitialPostsData {
  posts: Post[]
  hasNext: boolean
  nextCursor: string | null
}

interface BoardClientProps {
  initialData?: InitialPostsData
}

export default function BoardClient({ initialData }: BoardClientProps) {
  const [user, setUser] = useState<any>(null)
  const [isMember, setIsMember] = useState<boolean>(false)
  const [userLoading, setUserLoading] = useState(true)
  const [posts, setPosts] = useState<Post[]>(initialData?.posts || [])
  const [hasNext, setHasNext] = useState(initialData?.hasNext || false)
  const [nextCursor, setNextCursor] = useState<string | null>(initialData?.nextCursor || null)
  const [loading, setLoading] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()

  const category = searchParams.get('category') || '전체'
  const cursor = searchParams.get('cursor') || null

  // 사용자 인증 상태 관리
  useEffect(() => {
    let mounted = true

    const fetchUserAndProfile = async () => {
      console.log('🔍 [BoardClient] 사용자 인증 상태 확인 시작')
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          console.error('❌ [BoardClient] 세션 오류:', sessionError)
          if (mounted) {
            setUserLoading(false)
          }
          return
        }

        const currentUser = session?.user || null
        console.log('🔍 [BoardClient] 세션 확인 완료:', {
          hasUser: !!currentUser,
          userId: currentUser?.id,
        })

        if (!currentUser) {
          console.log('✅ [BoardClient] 로그인하지 않은 사용자 - userLoading false로 설정')
          if (mounted) {
            setUser(null)
            setIsMember(false)
            setUserLoading(false)
          }
          return
        }

        if (mounted) {
          setUser(currentUser)
        }

        // 프로필 정보 가져오기 (로그인한 사용자만)
        const { data: profile, error: profileError } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', currentUser.id)
          .single()

        if (profileError) {
          console.error('❌ [BoardClient] 프로필 조회 오류:', profileError)
          if (mounted) {
            setIsMember(false)
            setUserLoading(false)
          }
        } else if (profile && mounted) {
          console.log('✅ [BoardClient] 프로필 조회 성공, userLoading false로 설정')
          setIsMember(
            (profile as MemberProfile).registration_status === 'approved' &&
              (profile as MemberProfile).is_active
          )
          setUserLoading(false)
        }
      } catch (e) {
        console.error('❌ [BoardClient] fetchUserAndProfile 오류:', e)
        if (mounted) {
          setUser(null)
          setIsMember(false)
          setUserLoading(false)
          console.log('✅ [BoardClient] catch에서 userLoading false로 설정')
        }
      }
    }

    fetchUserAndProfile()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        const newUser = session?.user || null
        setUser(newUser)

        if (!newUser) {
          setIsMember(false)
        } else {
          fetchUserAndProfile()
        }
      }
    })

    return () => {
      mounted = false
      authListener?.subscription.unsubscribe()
    }
  }, [router])

  // 클라이언트에서 추가 데이터 로드 (커서 기반 페이지네이션)
  const loadMorePosts = async (newCursor: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: '20',
        cursor: newCursor,
        include_likes: 'true',
        ...(category !== '전체' && { category }),
      })

      const response = await fetch(`/api/posts?${params.toString()}`)
      const result = await response.json()

      if (result.success) {
        const { posts: newPosts, pagination } = result.data
        setPosts(newPosts)
        setHasNext(pagination.has_next)
        setNextCursor(pagination.next_cursor)
      }
    } catch (error) {
      console.error('게시글 로드 오류:', error)
    } finally {
      setLoading(false)
    }
  }

  // URL 변경 시 데이터 새로고침 및 초기 로드 폴백
  useEffect(() => {
    if (cursor && cursor !== nextCursor) {
      loadMorePosts(cursor)
    } else if (!cursor && initialData) {
      // 첫 페이지로 돌아온 경우 초기 데이터 사용
      setPosts(initialData.posts)
      setHasNext(initialData.hasNext)
      setNextCursor(initialData.nextCursor)
    } else if (!cursor && !initialData && posts.length === 0) {
      // 초기 데이터가 없고 커서도 없으면 첫 페이지 API 호출
      console.log('🔄 [BoardClient] 초기 데이터 없음, API 호출로 폴백')
      loadMorePosts('')
    }
  }, [cursor, category, initialData])

  const handleCategoryChange = (newCategory: string) => {
    const params = new URLSearchParams()
    if (newCategory !== '전체') {
      params.set('category', newCategory)
    }
    router.push(`/board?${params.toString()}`)
  }

  const handleNextPage = () => {
    if (nextCursor) {
      const params = new URLSearchParams()
      params.set('cursor', nextCursor)
      if (category !== '전체') {
        params.set('category', category)
      }
      router.push(`/board?${params.toString()}`)
    }
  }

  const handlePrevPage = () => {
    // 이전 페이지는 단순화: 첫 페이지로 돌아가기
    const params = new URLSearchParams()
    if (category !== '전체') {
      params.set('category', category)
    }
    router.push(`/board?${params.toString()}`)
  }

  if (userLoading) {
    return (
      <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">Loading...</div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 pt-8 pb-16">
        <div className="mb-8">
          <h2 className="heading-secondary mb-2">조합원 게시판</h2>
          <p className="text-gray-600">경기아트콜렉티브 협동조합 조합원들의 소통 공간입니다.</p>
        </div>

        {/* 비로그인 사용자 안내 */}
        {!user && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg relative z-10 pointer-events-auto">
            <p className="text-blue-800 mb-2">
              <strong>안내:</strong> 게시물을 읽어볼 수 있지만, 글 작성과 댓글, 좋아요는 조합원만
              가능합니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => router.push('/login')}
                type="button"
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                로그인
              </button>
              <button
                onClick={() => router.push('/signup')}
                type="button"
                className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 transition-colors focus:outline-none focus:ring-2 focus:ring-green-400"
              >
                조합원 가입
              </button>
            </div>
          </div>
        )}

        {/* 로그인했지만 승인 대기 중인 사용자 */}
        {!isMember && user && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg relative z-10 pointer-events-auto">
            <p className="text-yellow-800">
              <strong>알림:</strong> 조합원 승인 대기 중입니다. 승인 후 게시글 작성이 가능합니다.
            </p>
          </div>
        )}

        {/* 조합원만 글쓰기 버튼 표시 */}
        {isMember && user && (
          <div className="mb-6 relative z-10 pointer-events-auto">
            <button
              onClick={() => router.push('/board/write')}
              type="button"
              className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              새 게시글 작성
            </button>
          </div>
        )}

        <PostList
          posts={posts}
          currentUserId={user?.id}
          isMember={isMember}
          hasNext={hasNext}
          hasPrev={!!cursor}
          loading={loading}
          onNextPage={handleNextPage}
          onPrevPage={handlePrevPage}
          onCategoryChange={handleCategoryChange}
        />
      </div>
    </div>
  )
}
