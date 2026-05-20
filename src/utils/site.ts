// 정식 프로덕션 도메인. VERCEL_URL(immutable deploy URL)이 OG/canonical에
// 노출되면 공유 미리보기 캐시와 검색 색인에 잘못된 도메인이 박히기 때문에,
// production 배포에서는 항상 이 호스트로 고정한다.
// 다른 도메인 alias를 쓰려면 NEXT_PUBLIC_SITE_URL로 override.
const PRODUCTION_SITE_URL = 'https://ggac.kr'

export function getSiteUrl(): string {
  // 1) 명시적 설정 우선
  const explicit = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')

  // 2) Vercel production 배포 → 정식 도메인 강제
  if (process.env.VERCEL_ENV === 'production') {
    return PRODUCTION_SITE_URL
  }

  // 3) Preview/Development 배포는 배포별 URL을 사용
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/$/, '')
  }

  // 4) 프로덕션 기본값 안전 가드 (Vercel 외부에서 NODE_ENV=production)
  if (process.env.NODE_ENV === 'production') {
    return PRODUCTION_SITE_URL
  }

  // 5) 브라우저 환경
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  // 6) 로컬 기본값
  return 'http://localhost:3000'
}

/**
 * 페이지 경로와 현재 locale로 hreflang alternates 객체를 생성한다.
 * path는 '/'로 시작하는 locale-less 경로여야 한다 (예: '/about', '/artists/slug').
 */
export function getLocaleAlternates(path: string, locale: string) {
  const base = getSiteUrl()
  const koUrl = `${base}${path === '/' ? '' : path}`
  const enUrl = `${base}/en${path === '/' ? '' : path}`
  return {
    canonical: locale === 'en' ? enUrl : koUrl,
    languages: {
      'ko-KR': koUrl || base,
      'en-US': enUrl || `${base}/en`,
      'x-default': koUrl || base,
    } as Record<string, string>,
  }
}

/** locale 문자열을 OG locale 포맷으로 변환한다. */
export function getOgLocale(locale: string): string {
  return locale === 'en' ? 'en_US' : 'ko_KR'
}
