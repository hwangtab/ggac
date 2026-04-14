'use client'

import { useEffect } from 'react'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Admin] 페이지 오류:', error)
  }, [error])

  return (
    <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">
      <div className="text-center px-4">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">관리자 페이지 오류</h2>
        <p className="text-gray-600 mb-6">일시적인 오류가 발생했습니다. 다시 시도해주세요.</p>
        <button
          onClick={reset}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          다시 시도
        </button>
      </div>
    </div>
  )
}
