'use client'

import { useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { fetchSessionProfile } from '@/utils/sessionProfile'

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
        // 공용 세션 조회(모듈 캐시 + in-flight dedupe) — Navigation·활동 추적과 요청을 공유한다.
        const data = await fetchSessionProfile()

        if (!mounted) return

        const authenticated = data.authenticated
        setIsAuthenticated(authenticated)

        if (!authenticated || !data.profile) {
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

  // CLS: 로딩 중 자리 예약. 인증 상태를 확인하는 동안 null을 반환하면
  // 로드 후 인증 섹션이 채워지며 아래 게시글 목록을 밀어낸다(레이아웃 이동).
  // 실제 게스트 박스와 동일한 번역 문자열을 text-transparent로 렌더해
  // 뷰포트별 줄바꿈까지 동일하게 재현 → 높이가 자동으로 일치해 이동이 없다.
  // 최종 렌더(로드 완료 후)는 기존과 동일하다.
  if (loading) {
    return (
      <div
        className="space-y-4 mb-6 relative z-10"
        aria-hidden="true"
        data-testid="board-auth-skeleton"
      >
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg animate-pulse">
          <p className="text-transparent select-none mb-2">{t('userSection.guestInfo')}</p>
          <div className="flex gap-2">
            <span className="bg-gray-200 text-transparent select-none px-4 py-2 rounded text-sm">
              {t('userSection.login')}
            </span>
            <span className="bg-gray-200 text-transparent select-none px-4 py-2 rounded text-sm">
              {t('userSection.join')}
            </span>
          </div>
        </div>
      </div>
    )
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
