'use client'

import { useTranslations } from 'next-intl'

// 주의: loading.tsx에서 서버 getTranslations()를 쓰면 setRequestLocale을 호출할 수
// 없어 next-intl이 headers()로 폴백 → 세그먼트 전체가 동적 렌더링으로 강등된다.
// 클라이언트 useTranslations는 NextIntlClientProvider 컨텍스트를 읽으므로 안전하다.
export default function TicketsLoading() {
  const t = useTranslations('tickets')

  // 목록 카드와 같은 골격을 그려 콘텐츠가 들어올 때 레이아웃이 튀지 않게 한다.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40"
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-10">
          <div className="h-9 w-48 animate-pulse rounded bg-gray-200" />
          <div className="mt-3 h-5 w-80 max-w-full animate-pulse rounded bg-gray-200" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {[0, 1, 2, 3].map(index => (
            <div key={index} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="h-48 w-full animate-pulse bg-gray-200" />
              <div className="space-y-3 p-5">
                <div className="h-5 w-2/3 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  )
}
