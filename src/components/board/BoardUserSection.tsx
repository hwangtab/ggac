'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { MemberProfile } from '@/types'

const BoardUserSection = () => {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [isMember, setIsMember] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const fetchUserAndProfile = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!mounted) return

        const currentUser = session?.user || null
        setUser(currentUser)

        if (!currentUser) {
          setIsMember(false)
          setLoading(false)
          return
        }

        const { data: profile } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', currentUser.id)
          .single()

        if (mounted) {
          setIsMember(
            (profile as MemberProfile | null)?.registration_status === 'approved' &&
              (profile as MemberProfile | null)?.is_active === true
          )
          setLoading(false)
        }
      } catch {
        if (mounted) {
          setUser(null)
          setIsMember(false)
          setLoading(false)
        }
      }
    }

    fetchUserAndProfile()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
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

  if (loading) {
    return null
  }

  return (
    <div className="space-y-4 mb-6 relative z-10 pointer-events-auto">
      {!user && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-blue-800 mb-2">
            <strong>안내:</strong> 게시물을 읽어볼 수 있지만, 글 작성과 댓글, 좋아요는 조합원만
            가능합니다.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/login')}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
            >
              로그인
            </button>
            <button
              onClick={() => router.push('/signup')}
              className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700"
            >
              조합원 가입
            </button>
          </div>
        </div>
      )}

      {!isMember && user && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800">
            <strong>알림:</strong> 조합원 승인 대기 중입니다. 승인 후 게시글 작성이 가능합니다.
          </p>
        </div>
      )}

      {isMember && user && (
        <div>
          <button
            onClick={() => router.push('/board/write')}
            className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700"
          >
            새 게시글 작성
          </button>
        </div>
      )}
    </div>
  )
}

export default BoardUserSection
