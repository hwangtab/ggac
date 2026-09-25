'use client'

import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { reportClientError } from '@/utils/reportClientError'

export default function FundingError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('funding')
  useEffect(() => {
    console.error('funding route error:', error)
    reportClientError(error, 'FundingError')
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-gray-900">{t('error.title')}</h1>
        <p className="mt-2 text-gray-600">{t('error.body')}</p>
        <button type="button" onClick={reset} className="tw-btn-primary mt-6">
          {t('error.retry')}
        </button>
      </div>
    </div>
  )
}
