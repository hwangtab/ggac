/**
 * 공연 목록의 마크업. **서버 컴포넌트다** — 상호작용이 없으므로 클라이언트로
 * 내려보낼 이유가 없고, 크롤러가 첫 HTML에서 공연 정보를 그대로 읽는다.
 */

import { getTranslations } from 'next-intl/server'
import { FiCalendar, FiMapPin } from 'react-icons/fi'

import OptimizedImage from '@/components/OptimizedImage'
import { Link } from '@/i18n/navigation'

import { formatShowTime } from './format'
import type { PerformanceSummary } from './types'

interface Props {
  performances: PerformanceSummary[]
  locale: string
}

export default async function TicketsListContent({ performances, locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'tickets' })

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900 md:text-4xl">{t('list.heading')}</h1>
          <p className="mt-2 text-gray-600">{t('list.subtitle')}</p>
        </header>

        {performances.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
            <p className="text-gray-700">{t('list.emptyTitle')}</p>
            <p className="mt-1 text-sm text-gray-500">{t('list.emptyHint')}</p>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2">
            {performances.map((performance, index) => (
              <li key={performance.slug}>
                <Link
                  href={`/tickets/${performance.slug}`}
                  className="block h-full overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-primary-400 hover:shadow-md"
                >
                  {performance.poster_image && (
                    // 포스터는 비율이 제각각이라 컨테이너 높이를 고정하고 잘라 담는다.
                    <div className="relative h-48 w-full">
                      <OptimizedImage
                        src={performance.poster_image}
                        alt={t('list.posterAlt', { title: performance.title })}
                        fill
                        // 첫 두 장은 목록 상단에 보이므로 LCP 후보다.
                        priority={index < 2}
                        sizes="(max-width: 640px) 100vw, 50vw"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="p-5">
                    <h2 className="text-lg font-semibold text-gray-900">{performance.title}</h2>
                    {performance.summary && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                        {performance.summary}
                      </p>
                    )}
                    <dl className="mt-3 space-y-1 text-sm text-gray-600">
                      {performance.next_show_at && (
                        <div className="flex items-center gap-1.5">
                          <FiCalendar className="h-4 w-4 flex-none" aria-hidden />
                          <dt className="sr-only">{t('list.nextShowLabel')}</dt>
                          <dd>
                            {formatShowTime(performance.next_show_at, locale)}
                            {performance.show_count > 1 &&
                              ` ${t('list.moreShows', { count: performance.show_count - 1 })}`}
                          </dd>
                        </div>
                      )}
                      {performance.venue && (
                        <div className="flex items-center gap-1.5">
                          <FiMapPin className="h-4 w-4 flex-none" aria-hidden />
                          <dt className="sr-only">{t('list.venueLabel')}</dt>
                          <dd>{performance.venue}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
