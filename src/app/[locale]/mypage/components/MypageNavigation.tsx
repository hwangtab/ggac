'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { FiUser, FiMusic, FiActivity, FiSettings, FiChevronRight } from 'react-icons/fi'
import { MypageMenuItem } from '@/types'
import PermissionCheck from './PermissionCheck'
import { fetchSessionProfile } from '@/utils/sessionProfile'

interface MypageNavigationProps {
  currentPath: string
}

const MypageNavigation: React.FC<MypageNavigationProps> = ({ currentPath }) => {
  const t = useTranslations('mypage')
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const getUser = async () => {
      try {
        // 공용 세션 조회(모듈 캐시 + in-flight dedupe) — PermissionCheck와 요청을 공유한다.
        const data = await fetchSessionProfile()

        if (data.authenticated) {
          setUser(data.user || null)
          setProfile(data.profile || null)
        }
      } catch (error) {
        console.error('Error fetching user:', error)
      } finally {
        setLoading(false)
      }
    }

    getUser()
  }, [])

  const menuItems: MypageMenuItem[] = [
    {
      id: 'dashboard',
      label: t('nav.dashboard'),
      href: '/mypage',
      icon: FiActivity,
      isActive: currentPath === '/mypage',
    },
    {
      id: 'profile',
      label: t('nav.profile'),
      href: '/mypage/profile',
      icon: FiUser,
      requiredPermission: 'member',
      isActive: currentPath === '/mypage/profile',
    },
    {
      id: 'artist',
      label: t('nav.artist'),
      href: '/mypage/artist',
      icon: FiMusic,
      requiredPermission: 'artist',
      isActive: currentPath === '/mypage/artist',
    },
    {
      id: 'activity',
      label: t('nav.activity'),
      href: '/mypage/activity',
      icon: FiActivity,
      requiredPermission: 'member',
      isActive: currentPath === '/mypage/activity',
    },
    {
      id: 'settings',
      label: t('nav.settings'),
      href: '/mypage/settings',
      icon: FiSettings,
      requiredPermission: 'member',
      isActive: currentPath === '/mypage/settings',
      badge: t('nav.settingsBadge'),
    },
  ]

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* 사용자 정보 */}
      <div className="bg-gradient-to-r from-primary-50 to-accent-50 p-6 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-accent-500 rounded-full flex items-center justify-center">
            <span className="text-white font-semibold text-sm">
              {profile?.display_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {profile?.display_name || t('nav.userDefault')}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {profile?.is_artist ? t('nav.roleArtist') : t('nav.roleMember')}
            </p>
          </div>
        </div>
      </div>

      {/* 메뉴 */}
      <nav className="p-4">
        <ul className="space-y-1">
          {menuItems.map(item => {
            const IconComponent = item.icon
            const isActive = item.isActive

            // 권한이 필요한 메뉴 아이템 처리
            if (item.requiredPermission && item.requiredPermission !== 'member') {
              return (
                <li key={item.id}>
                  <PermissionCheck
                    requiredPermission={item.requiredPermission}
                    fallback={
                      <div className="flex items-center px-3 py-2 text-sm text-gray-400 cursor-not-allowed">
                        {IconComponent && <IconComponent className="w-4 h-4 mr-3" />}
                        <span className="flex-1">{item.label}</span>
                        <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                          {t('nav.noPermission')}
                        </span>
                      </div>
                    }
                  >
                    <Link
                      href={item.href}
                      className={`flex items-center px-3 py-2 text-sm rounded-md transition-colors duration-200 ${
                        isActive
                          ? 'bg-primary-100 text-primary-700 font-medium'
                          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      {IconComponent && <IconComponent className="w-4 h-4 mr-3" />}
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="text-xs bg-accent-100 text-accent-700 px-2 py-1 rounded">
                          {item.badge}
                        </span>
                      )}
                      {isActive && <FiChevronRight className="w-4 h-4 ml-2" />}
                    </Link>
                  </PermissionCheck>
                </li>
              )
            }

            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={`flex items-center px-3 py-2 text-sm rounded-md transition-colors duration-200 ${
                    isActive
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {IconComponent && <IconComponent className="w-4 h-4 mr-3" />}
                  <span className="flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="text-xs bg-accent-100 text-accent-700 px-2 py-1 rounded">
                      {item.badge}
                    </span>
                  )}
                  {isActive && <FiChevronRight className="w-4 h-4 ml-2" />}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* 도움말 */}
      <div className="p-4 border-t border-gray-200">
        <div className="text-xs text-gray-500">
          <p className="mb-2">{t('nav.helpPrompt')}</p>
          <p>{t('nav.helpBody')}</p>
        </div>
      </div>
    </div>
  )
}

export default MypageNavigation
