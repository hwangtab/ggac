'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Global] 루트 레이아웃 오류:', error)
  }, [error])

  return (
    <html lang="ko">
      <body>
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
              페이지를 불러올 수 없습니다
            </h2>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
              일시적인 오류가 발생했습니다. 다시 시도해주세요.
            </p>
            <button
              onClick={reset}
              style={{ padding: '0.5rem 1.5rem', backgroundColor: '#7c3aed', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}
            >
              다시 시도
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
