'use client'

import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

export default function ProjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('projects')

  useEffect(() => {
    console.error('[Projects] 페이지 오류:', error)
  }, [error])

  return (
    <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">
      <div className="text-center px-4">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">{t('error.heading')}</h2>
        <p className="text-gray-600 mb-6">{t('error.body')}</p>
        <button
          onClick={reset}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          {t('error.retry')}
        </button>
      </div>
    </div>
  )
}
