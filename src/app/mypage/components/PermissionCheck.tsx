'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PermissionCheckProps } from '@/types'
import { supabase } from '@/lib/supabase/client'

const PermissionCheck: React.FC<PermissionCheckProps> = ({
  children,
  requiredPermission,
  fallback,
  redirectTo,
}) => {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const checkPermission = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!session?.user) {
          setLoading(false)
          return
        }

        setUser(session.user)

        // 프로필 정보 가져오기
        const { data: profileData, error } = await supabase
          .from('member_profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (error) {
          console.error('Profile fetch error:', error)
          setLoading(false)
          return
        }

        setProfile(profileData)

        // 권한 확인
        let hasAccess = false

        switch (requiredPermission) {
          case 'member':
            hasAccess =
              (profileData as any)?.registration_status === 'approved' &&
              (profileData as any)?.is_active === true
            break
          case 'artist':
            hasAccess =
              (profileData as any)?.registration_status === 'approved' &&
              (profileData as any)?.is_active === true &&
              (profileData as any)?.is_artist === true &&
              (profileData as any)?.artist_id !== null
            break
          case 'admin':
            hasAccess =
              (profileData as any)?.registration_status === 'approved' &&
              (profileData as any)?.is_active === true &&
              (profileData as any)?.is_admin === true
            break
        }

        setHasPermission(hasAccess)

        // 리다이렉트 처리
        if (!hasAccess && redirectTo) {
          router.push(redirectTo)
        }
      } catch (error) {
        console.error('Permission check error:', error)
      } finally {
        setLoading(false)
      }
    }

    checkPermission()

    // 인증 상태 변경 감지
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      checkPermission()
    })

    return () => subscription.unsubscribe()
  }, [requiredPermission, redirectTo, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!user || !profile) {
    return (
      fallback || (
        <div className="text-center p-8">
          <div className="text-gray-500">
            <p className="text-lg font-medium mb-2">로그인이 필요합니다</p>
            <p className="text-sm">이 페이지에 접근하려면 로그인해 주세요.</p>
            <button onClick={() => router.push('/login')} className="mt-4 btn-primary">
              로그인하기
            </button>
          </div>
        </div>
      )
    )
  }

  if (!hasPermission) {
    // 권한별 기본 메시지
    const getDefaultMessage = () => {
      switch (requiredPermission) {
        case 'member':
          if (profile.registration_status === 'pending') {
            return {
              title: '승인 대기 중',
              description: '조합원 가입 승인을 기다리고 있습니다.',
              action: '승인 상태 확인',
              actionHref: '/register/pending',
            }
          } else if (profile.registration_status === 'rejected') {
            return {
              title: '가입 승인 거부',
              description: '조합원 가입이 거부되었습니다.',
              action: '자세히 보기',
              actionHref: '/register/rejected',
            }
          } else if (!profile.is_active) {
            return {
              title: '계정 비활성화',
              description: '계정이 비활성화되어 있습니다.',
              action: '문의하기',
              actionHref: '/connect',
            }
          }
          break
        case 'artist':
          if (!profile.is_artist) {
            return {
              title: '아티스트 권한 없음',
              description: '아티스트 권한이 필요합니다.',
              action: '조합원 가입',
              actionHref: '/connect',
            }
          } else if (!profile.artist_id) {
            return {
              title: '아티스트 ID 미할당',
              description: '아티스트 ID가 할당되지 않았습니다.',
              action: '관리자 문의',
              actionHref: '/connect',
            }
          }
          break
        case 'admin':
          return {
            title: '관리자 권한 필요',
            description: '이 기능은 관리자만 사용할 수 있습니다.',
            action: '메인으로',
            actionHref: '/',
          }
      }

      return {
        title: '접근 권한 없음',
        description: '이 페이지에 접근할 권한이 없습니다.',
        action: '메인으로',
        actionHref: '/',
      }
    }

    return (
      fallback || (
        <div className="text-center p-8">
          <div className="text-gray-500">
            {(() => {
              const message = getDefaultMessage()
              return (
                <>
                  <p className="text-lg font-medium mb-2">{message.title}</p>
                  <p className="text-sm mb-4">{message.description}</p>
                  <button onClick={() => router.push(message.actionHref)} className="btn-primary">
                    {message.action}
                  </button>
                </>
              )
            })()}
          </div>
        </div>
      )
    )
  }

  return <>{children}</>
}

export default PermissionCheck
