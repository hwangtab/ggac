'use client'

import { useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'

const BoardUserSection = () => {
  const router = useRouter()
  const t = useTranslations('board')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isMember, setIsMember] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const fetchUserAndProfile = async () => {
      try {
        const response = await fetch('/api/auth/verify-session', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        })
        const data = (await response.json().catch(() => null)) as {
          authenticated?: boolean
          profile?: {
            registration_status?: string
            is_active?: boolean
          } | null
        } | null

        if (!mounted) return

        const authenticated = !!(response.ok && data?.authenticated)
        setIsAuthenticated(authenticated)

        if (!authenticated || !data?.profile) {
          setIsMember(false)
          setLoading(false)
          return
        }

        setIsMember(
          data.profile.registration_status === 'approved' && data.profile.is_active === true
        )
        setLoading(false)
      } catch {
        if (mounted) {
          setIsAuthenticated(false)
          setIsMember(false)
          setLoading(false)
        }
      }
    }

    fetchUserAndProfile()

    return () => {
      mounted = false
    }
  }, [])

  if (loading) {
    return null
  }

  return (
    <div className="space-y-4 mb-6 relative z-10 pointer-events-auto">
      {!isAuthenticated && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-blue-800 mb-2">{t('userSection.guestInfo')}</p>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/login')}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
            >
              {t('userSection.login')}
            </button>
            <button
              onClick={() => router.push('/signup')}
              className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700"
            >
              {t('userSection.join')}
            </button>
          </div>
        </div>
      )}

      {!isMember && isAuthenticated && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800">{t('userSection.pendingInfo')}</p>
        </div>
      )}

      {isMember && isAuthenticated && (
        <div>
          <button
            onClick={() => router.push('/board/write')}
            className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700"
          >
            {t('userSection.writeButton')}
          </button>
        </div>
      )}
    </div>
  )
}

export default BoardUserSection
