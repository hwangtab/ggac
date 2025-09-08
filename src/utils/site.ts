export function getSiteUrl(): string {
  // 1) 명시적 설정 우선
  const explicit = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')

  // 2) Vercel 환경 자동 감지
  if (process.env.VERCEL_URL) {
    const url = `https://${process.env.VERCEL_URL}`
    return url.replace(/\/$/, '')
  }

  // 3) 프로덕션 기본값 안전 가드
  if (process.env.NODE_ENV === 'production') {
    return 'https://ggac.kr'
  }

  // 4) 브라우저 환경
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  // 5) 로컬 기본값
  return 'http://localhost:3000'
}
