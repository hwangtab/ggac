import { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { FiUser, FiSettings, FiMusic, FiActivity } from 'react-icons/fi'
import MypageLayout from './components/MypageLayout'
import DashboardCard from './components/DashboardCard'
import PermissionCheck from './components/PermissionCheck'

export const metadata: Metadata = {
  title: '마이페이지',
  description: '개인 프로필 및 아티스트 정보를 관리하세요.',
  robots: {
    index: false,
    follow: false,
  },
}

export default async function MypagePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('mypage')

  return (
    <PermissionCheck
      requiredPermission="member"
      fallback={
        <MypageLayout title={t('pendingFallbackTitle')} description={t('pendingFallbackDesc')}>
          <div className="text-center py-12">
            <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-amber-100 mb-6">
              <svg
                className="h-8 w-8 text-amber-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">{t('pendingHeading')}</h2>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">{t('pendingBody')}</p>
            <div className="space-y-3">
              <Link
                href="/register/pending"
                className="inline-block bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
              >
                {t('checkStatusButton')}
              </Link>
              <div>
                <Link
                  href="/"
                  className="text-gray-500 hover:text-gray-700 text-sm underline underline-offset-4 hover:underline-offset-6"
                >
                  {t('homeLink')}
                </Link>
              </div>
            </div>
          </div>
        </MypageLayout>
      }
    >
      <MypageLayout title={t('heading')} description={t('description')}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <DashboardCard
            title={t('profileCardTitle')}
            description={t('profileCardDesc')}
            icon={<FiUser className="w-8 h-8 text-primary-600" />}
            href="/mypage/profile"
            buttonText={t('profileCardButton')}
          />

          <PermissionCheck
            requiredPermission="artist"
            fallback={
              <DashboardCard
                title={t('artistCardTitle')}
                description={t('artistCardDisabledDesc')}
                icon={<FiMusic className="w-8 h-8 text-gray-400" />}
                disabled
              />
            }
          >
            <DashboardCard
              title={t('artistCardTitle')}
              description={t('artistCardDesc')}
              icon={<FiMusic className="w-8 h-8 text-accent-600" />}
              href="/mypage/artist"
              buttonText={t('artistCardButton')}
            />
          </PermissionCheck>

          <DashboardCard
            title={t('activityCardTitle')}
            description={t('activityCardDesc')}
            icon={<FiActivity className="w-8 h-8 text-green-600" />}
            href="/mypage/activity"
            buttonText={t('activityCardButton')}
          />

          <DashboardCard
            title={t('settingsCardTitle')}
            description={t('settingsCardDesc')}
            icon={<FiSettings className="w-8 h-8 text-blue-600" />}
            href="/mypage/settings"
            buttonText={t('settingsCardButton')}
          />
        </div>

        <div className="mt-8 bg-gradient-to-r from-primary-50 to-accent-50 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('helpHeading')}</h2>
          <div className="text-sm text-gray-600 space-y-2">
            <p>• {t('helpProfile')}</p>
            <p>• {t('helpArtist')}</p>
            <p>• {t('helpContact')}</p>
          </div>
        </div>
      </MypageLayout>
    </PermissionCheck>
  )
}
