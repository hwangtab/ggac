'use client'

import { useTranslations } from 'next-intl'

// 주의: loading.tsx에서 서버 getTranslations()를 쓰면 setRequestLocale을 호출할 수
// 없어 next-intl이 headers()로 폴백 → 세그먼트 전체가 동적 렌더링으로 강등된다.
export default function FundingLoading() {
  const t = useTranslations('funding')
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40"
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-10">
          <div className="h-9 w-32 animate-pulse rounded bg-gray-200" />
          <div className="mt-3 h-5 w-72 max-w-full animate-pulse rounded bg-gray-200" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="aspect-[16/9] w-full animate-pulse bg-gray-200" />
              <div className="space-y-3 p-5">
                <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
                <div className="h-6 w-3/4 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                <div className="h-2 w-full animate-pulse rounded-full bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  )
}
