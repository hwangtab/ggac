'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import PostList from '@/components/PostList'
import type { MemberProfile, Post } from '@/types'

interface BoardClientProps {
  initialData: {
    posts: Post[]
    hasNext: boolean
    hasPrev: boolean
    currentPage: number
  }
  category: string
  page: number
}

const BoardClient = ({ initialData, category, page }: BoardClientProps) => {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [isMember, setIsMember] = useState(false)
  const [userLoading, setUserLoading] = useState(true)
  const [posts, setPosts] = useState<Post[]>(initialData.posts)
  const [hasNext, setHasNext] = useState(initialData.hasNext)
  const [hasPrev, setHasPrev] = useState(initialData.hasPrev)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setPosts(initialData.posts)
    setHasNext(initialData.hasNext)
    setHasPrev(initialData.hasPrev)
    setLoading(false)
  }, [initialData])

  useEffect(() => {
    let mounted = true

    const fetchUserAndProfile = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          console.error('세션 조회 오류:', sessionError)
          if (mounted) {
            setUserLoading(false)
          }
          return
        }

        const currentUser = session?.user || null

        if (!currentUser) {
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

        const { data: profile, error: profileError } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', currentUser.id)
          .single()

        if (profileError) {
          console.error('프로필 조회 오류:', profileError)
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
      } catch (error) {
        console.error('fetchUserAndProfile 실패:', error)
        if (mounted) {
          setUser(null)
          setIsMember(false)
          setUserLoading(false)
        }
      }
    }

    fetchUserAndProfile()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      const newUser = session?.user || null
      setUser(newUser)
      if (!newUser) {
        setIsMember(false)
      } else {
        fetchUserAndProfile()
      }
    })

    return () => {
      mounted = false
      authListener?.subscription.unsubscribe()
    }
  }, [])

  const buildBoardUrl = (params: { category?: string; page?: number }) => {
    const search = new URLSearchParams()
    if (params.category && params.category !== '전체') {
      search.set('category', params.category)
    }
    if (params.page && params.page > 1) {
      search.set('page', params.page.toString())
    }
    const query = search.toString()
    return query ? `/board?${query}` : '/board'
  }

  const handleCategoryChange = (newCategory: string) => {
    setLoading(true)
    router.push(buildBoardUrl({ category: newCategory, page: 1 }))
  }

  const handleNextPage = () => {
    if (!hasNext) return
    setLoading(true)
    router.push(buildBoardUrl({ category, page: page + 1 }))
  }

  const handlePrevPage = () => {
    if (!hasPrev) return
    setLoading(true)
    router.push(buildBoardUrl({ category, page: Math.max(1, page - 1) }))
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 pt-8 pb-16">
        <div className="mb-8">
          <h2 className="heading-secondary mb-2">조합원 게시판</h2>
          <p className="text-gray-600">경기아트콜렉티브 협동조합 조합원들의 소통 공간입니다.</p>
        </div>

        {!user && !userLoading && (
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

        {!isMember && user && !userLoading && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg relative z-10 pointer-events-auto">
            <p className="text-yellow-800">
              <strong>알림:</strong> 조합원 승인 대기 중입니다. 승인 후 게시글 작성이 가능합니다.
            </p>
          </div>
        )}

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
          hasPrev={hasPrev}
          loading={loading}
          onNextPage={handleNextPage}
          onPrevPage={handlePrevPage}
          onCategoryChange={handleCategoryChange}
          selectedCategory={category}
        />
      </div>
    </div>
  )
}

export default BoardClient
