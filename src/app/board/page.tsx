'use client'

// 정적 생성 방지 - 동적 데이터를 사용하는 페이지
export const dynamic = 'force-dynamic'

import { supabase } from '../../lib/supabase/client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PostList from '../../components/PostList'
import CreatePostForm from '../../components/CreatePostForm'
import { usePagination } from '../../hooks/usePagination'
import { usePostsWithPagination } from '../../hooks/usePostsWithPagination'
import type { MemberProfile } from '@/types'

// 🚀 성능 최적화: 클라이언트 컴포넌트이므로 캐싱은 Hook과 API에서 처리

function BoardContent() {
  const [user, setUser] = useState<any>(null)
  const [isMember, setIsMember] = useState<boolean>(false)
  const [userLoading, setUserLoading] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()

  // 페이지네이션 상태 관리
  const category = searchParams.get('category') || '전체'
  const [paginationState, paginationActions] = usePagination({
    initialPage: 1,
    pageSize: 10,
    totalCount: 0,
  })

  // 페이지네이션된 게시글 데이터
  const {
    posts,
    totalCount,
    loading: postsLoading,
    error,
  } = usePostsWithPagination({
    page: paginationState.currentPage,
    pageSize: paginationState.pageSize,
    category: category,
  })

  // 총 개수가 변경될 때마다 페이지네이션 상태 업데이트
  useEffect(() => {
    paginationActions.setTotalCount(totalCount)
  }, [totalCount, paginationActions])

  useEffect(() => {
    let mounted = true

    const fetchUserAndProfile = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          console.error('Error getting session:', sessionError)
          if (mounted) {
            setUserLoading(false)
            // 세션 오류가 있어도 비로그인 사용자로 게시판 이용 가능
          }
          return
        }

        const currentUser = session?.user || null

        if (!currentUser) {
          if (mounted) {
            setUser(null)
            setIsMember(false)
            setUserLoading(false)
            // 비로그인 사용자도 게시판 조회 가능
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
          console.error('Error fetching profile:', profileError)
          if (mounted) {
            setIsMember(false)
            setUserLoading(false)
          }
        } else if (profile && mounted) {
          setIsMember(
            (profile as MemberProfile).registration_status === 'approved' &&
              (profile as MemberProfile).is_active
          )
          setUserLoading(false)
        }
      } catch (e) {
        console.error('Error in fetchUserAndProfile:', e)
        if (mounted) {
          setUser(null)
          setIsMember(false)
          setUserLoading(false)
          // 에러가 발생해도 비로그인 사용자로 게시판 이용 가능
        }
      }
    }

    fetchUserAndProfile()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        const newUser = session?.user || null
        setUser(newUser)

        if (!newUser) {
          // 로그아웃 시에도 게시판은 계속 이용 가능
          setIsMember(false)
        } else {
          // 로그인 시 멤버 상태 다시 확인
          fetchUserAndProfile()
        }
      }
    })

    return () => {
      mounted = false
      authListener?.subscription.unsubscribe()
    }
  }, [router])

  const handleCategoryChange = (newCategory: string) => {
    // 카테고리 변경시 페이지를 1로 리셋
    paginationActions.goToPage(1)
    paginationActions.updateUrlParams(1, newCategory)
  }

  const handlePageChange = (page: number) => {
    paginationActions.goToPage(page)
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
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-800 mb-2">
              <strong>안내:</strong> 게시물을 읽어볼 수 있지만, 글 작성과 댓글, 좋아요는 조합원만
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

        {/* 로그인했지만 승인 대기 중인 사용자 */}
        {!isMember && user && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800">
              <strong>알림:</strong> 조합원 승인 대기 중입니다. 승인 후 게시글 작성이 가능합니다.
            </p>
          </div>
        )}

        {/* 조합원만 글쓰기 버튼 표시 */}
        {isMember && user && (
          <div className="mb-6">
            <button
              onClick={() => router.push('/board/write')}
              className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              새 게시글 작성
            </button>
          </div>
        )}
        <PostList
          posts={posts}
          currentUserId={user?.id}
          isMember={isMember}
          currentPage={paginationState.currentPage}
          totalPages={paginationState.totalPages}
          totalCount={paginationState.totalCount}
          pageSize={paginationState.pageSize}
          loading={postsLoading}
          onPageChange={handlePageChange}
          onCategoryChange={handleCategoryChange}
        />
      </div>
    </div>
  )
}

interface Post {
  id: string
  title: string
  content: string
  category: string
  author_id: string
  created_at: string
}

export default function BoardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <BoardContent />
    </Suspense>
  )
}
