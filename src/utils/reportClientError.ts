'use client'

/**
 * React 에러 바운더리(`error.tsx`/`global-error.tsx`)가 잡은 오류를
 * `/api/client-error`로 보낸다. 그전까지는 `console.error`로만 남아
 * 브라우저를 직접 열어보지 않는 한 팀이 절대 볼 수 없었다.
 *
 * fire-and-forget이다 — 에러 화면 자체를 막으면 안 되므로 실패해도 삼킨다.
 */
export function reportClientError(
  error: Error & { digest?: string },
  boundaryName: string
): void {
  if (typeof window === 'undefined') return

  fetch('/api/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      errorId: error.digest || `${boundaryName}_${Date.now()}`,
      componentStack: boundaryName,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      url: window.location.href,
    }),
  }).catch(() => {
    // 오류 보고 실패가 또 다른 UI 오류를 만들면 안 된다.
  })
}
