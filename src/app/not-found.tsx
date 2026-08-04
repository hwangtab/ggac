import Link from 'next/link'

/**
 * 루트 404.
 *
 * 로케일에 매칭되지 않는 경로(예: /없는페이지)는 `[locale]` 세그먼트를 거치지
 * 않으므로 `[locale]/not-found.tsx`도, 거기 딸린 레이아웃·프로바이더도 렌더되지
 * 않는다. 이 파일이 없으면 Next.js 기본 404(흰 배경 + "This page could not be
 * found.")가 그대로 노출된다 — 사이트 전체가 다크 포스터인데 오타 하나로
 * 흰 화면을 만나게 된다.
 *
 * 루트 레이아웃은 children만 반환하고 <html>/<body>는 `[locale]` 레이아웃에
 * 있으므로, 여기서는 스타일을 인라인으로 확정한다(globals.css는 로드되지만
 * body 규칙이 적용될 <body>가 이 트리에 없다).
 */
export default function NotFound() {
  return (
    <html lang="ko">
      <body style={{ margin: 0, backgroundColor: '#08080a' }}>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.5rem',
            padding: '1.5rem',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.92)',
            fontFamily:
              "'Pretendard Variable', 'Pretendard Fallback', system-ui, -apple-system, sans-serif",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '11px',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: 'rgba(255, 255, 255, 0.6)',
            }}
          >
            404 — NOT FOUND
          </p>
          <h1
            style={{
              margin: 0,
              fontWeight: 900,
              lineHeight: 0.94,
              letterSpacing: '-0.045em',
              fontSize: 'clamp(2rem, 8vw, 5rem)',
            }}
          >
            여긴 아무것도 없습니다
          </h1>
          <p style={{ margin: 0, fontSize: '15px', color: 'rgba(255, 255, 255, 0.72)' }}>
            주소가 바뀌었거나 지워진 페이지입니다.
          </p>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              minHeight: '48px',
              alignItems: 'center',
              padding: '0 2rem',
              backgroundColor: '#ffffff',
              color: '#000000',
              fontSize: '14px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            홈으로
          </Link>
        </main>
      </body>
    </html>
  )
}
