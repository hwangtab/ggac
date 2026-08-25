import { Link, redirect } from '@/i18n/navigation'
import { readSessionUser } from '@/lib/server/session'
import { getProfileById } from '@/db/queries/profiles'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import WritePageClient from './WritePageClient'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface WritePageProps {
  params: Promise<{ locale: Locale }>
}

export default async function WritePage({ params }: WritePageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('board')

  const user = await readSessionUser()

  if (!user) {
    redirect({
      href: {
        pathname: '/login',
        query: { redirect: '/board/write' },
      },
      locale,
    })
  }

  // 조회 자체가 실패해도(연결 오류 등) 이전 Supabase `.single()` 실패 시와
  // 동일하게 "회원 아님"으로 취급한다(fail-closed, 500 승격하지 않음).
  let profile: Awaited<ReturnType<typeof getProfileById>> = null
  try {
    profile = await getProfileById(user.id)
  } catch {
    profile = null
  }
  const isMember = profile?.registration_status === 'approved' && profile?.is_active === true

  if (!isMember) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h1 className="text-2xl font-bold text-yellow-800 mb-4">{t('write.noAccess')}</h1>
              <p className="text-yellow-700 mb-4">{t('write.noAccessBody')}</p>
              <Link
                href="/board"
                className="inline-block bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
              >
                {t('write.backToBoard')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <WritePageClient userId={user.id} />
}
