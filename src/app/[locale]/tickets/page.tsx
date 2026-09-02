'use client'

/**
 * 예매 가능한 공연 목록. **로그인 없이 볼 수 있다** — 표를 사려면 먼저
 * 조합원이 되어야 한다면 아무도 사지 않는다.
 */

import { useEffect, useState } from 'react'
import { FiCalendar, FiMapPin } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'

interface PerformanceSummary {
  slug: string
  title: string
  summary: string | null
  venue: string | null
  poster_image: string | null
  next_show_at: string | null
  show_count: number
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TicketsPage() {
  const [performances, setPerformances] = useState<PerformanceSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/tickets')
        const result = (await response.json().catch(() => null)) as {
          data?: { performances?: PerformanceSummary[] }
        } | null
        setPerformances(result?.data?.performances ?? [])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900 md:text-4xl">공연 예매</h1>
          <p className="mt-2 text-gray-600">
            경기아트콜렉티브가 기획한 공연을 예매하실 수 있습니다.
          </p>
        </header>

        {loading ? (
          <p className="py-16 text-center text-gray-500">불러오는 중…</p>
        ) : performances.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
            <p className="text-gray-700">현재 예매 중인 공연이 없습니다.</p>
            <p className="mt-1 text-sm text-gray-500">
              새로운 공연 소식은 인스타그램에서 먼저 알려드립니다.
            </p>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2">
            {performances.map(performance => (
              <li key={performance.slug}>
                <Link
                  href={`/tickets/${performance.slug}`}
                  className="block h-full overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-primary-400 hover:shadow-md"
                >
                  {performance.poster_image && (
                    // 공연 포스터는 비율이 제각각이라 크기를 고정하지 않는다.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={performance.poster_image}
                      alt=""
                      className="h-48 w-full object-cover"
                      loading="lazy"
                    />
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
                          <dd>
                            {formatDate(performance.next_show_at)}
                            {performance.show_count > 1 && ` 외 ${performance.show_count - 1}회차`}
                          </dd>
                        </div>
                      )}
                      {performance.venue && (
                        <div className="flex items-center gap-1.5">
                          <FiMapPin className="h-4 w-4 flex-none" aria-hidden />
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
