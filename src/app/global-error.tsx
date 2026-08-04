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
      {/*
        이 화면은 로케일 레이아웃 밖에서 렌더돼 globals.css의 테마가 닿지 않는다.
        사이트가 전부 다크인데 여기만 흰 화면이 되지 않도록 인라인으로 지정한다.
      */}
      <body style={{ backgroundColor: '#08080a', color: 'rgba(255,255,255,0.92)' }}>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '1rem',
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
              페이지를 불러올 수 없습니다
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.72)', marginBottom: '1.5rem' }}>
              일시적인 오류가 발생했습니다. 다시 시도해주세요.
            </p>
            <button
              onClick={reset}
              style={{
                padding: '0.5rem 1.5rem',
                backgroundColor: '#ffffff',
                color: '#000000',
                borderRadius: '2px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
