import { logicalPathFromUrl } from '@/lib/storage/paths'

export function isSafeInternalPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//')
}

const SAFE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'])

export function toSafeInternalImagePath(value: unknown, fallback = '/images/logo/gac_og.webp') {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  if (!isSafeInternalPath(trimmed)) return fallback

  try {
    const parsed = new URL(trimmed, 'https://ggac.local')
    if (parsed.origin !== 'https://ggac.local') return fallback

    const pathname = parsed.pathname || ''
    const extension = pathname.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase()
    if (!extension || !SAFE_IMAGE_EXTENSIONS.has(extension)) return fallback

    return `${pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

/**
 * 아티스트 프로필 이미지 src로 안전하게 사용할 값으로 정규화한다.
 * - 내부 경로(`/images/...`): toSafeInternalImagePath 검증 적용
 * - 우리 Blob 저장소의 `artists` 버킷 public URL: 그대로 허용
 *   (마이페이지 업로드 사진이 저장되는 유일한 신뢰 경로)
 * - 그 외(임의 외부 URL, 다른 버킷, 잘못된 값): fallback(기본 로고)
 *
 * 호스트 와일드카드를 허용하던 예전 방식과 달리 origin이 우리 Blob 공개
 * 저장소와 정확히 일치하고 경로가 `artists` 버킷일 때만 통과시켜 SSRF/피싱
 * 표면을 넓히지 않으면서도 업로드 사진 표시 회귀를 막는다.
 * 화면 렌더링·OG 메타데이터·JSON-LD가 모두 이 helper를 공유해 경계를 통일한다.
 */
export function toSafeArtistImageSrc(
  value: unknown,
  fallback = '/images/logo/gac_og.webp'
): string {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  if (isSafeInternalPath(trimmed)) {
    return toSafeInternalImagePath(trimmed, fallback)
  }

  if (logicalPathFromUrl(trimmed, 'artists') !== null) {
    return trimmed
  }

  return fallback
}

const AUTH_REDIRECT_BLOCKLIST = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/auth',
]

const SUPPORTED_LOCALES = ['ko', 'en'] as const

function stripSupportedLocalePrefix(pathname: string): string {
  const segments = pathname.split('/')
  const maybeLocale = segments[1]

  if (!SUPPORTED_LOCALES.some(locale => locale === maybeLocale)) {
    return pathname
  }

  const stripped = `/${segments.slice(2).join('/')}`
  return stripped === '/' ? '/' : stripped.replace(/\/+$/, '') || '/'
}

export function toSafeInternalRedirectPath(value: string | null, fallback = '/board'): string {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  if (!isSafeInternalPath(trimmed)) return fallback

  try {
    const parsed = new URL(trimmed, 'https://ggac.local')
    if (parsed.origin !== 'https://ggac.local') return fallback

    const path = parsed.pathname || '/'
    const redirectPathname = stripSupportedLocalePrefix(path)
    if (
      AUTH_REDIRECT_BLOCKLIST.some(
        blocked => redirectPathname === blocked || redirectPathname.startsWith(`${blocked}/`)
      )
    ) {
      return fallback
    }

    return `${path}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SAFE_EMAIL_PATTERN = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/

export function toSafeHttpUrl(value: string): string | null {
  if (typeof value !== 'string') return null

  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function toSafeEmailHref(value: string): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!SAFE_EMAIL_PATTERN.test(trimmed)) return null

  return `mailto:${trimmed}`
}

export function toSafePhoneHref(value: string): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  const normalized = trimmed.replace(/[\s\-().]/g, '')
  if (!/^\+?\d{6,20}$/.test(normalized)) return null

  return `tel:${normalized}`
}

export function toSafeNaverMapSearchHref(value: string): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null

  return `https://map.naver.com/v5/search/${encodeURIComponent(trimmed)}`
}

export function toSafeLinkHref(value: string): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (isSafeInternalPath(trimmed)) return trimmed

  try {
    const parsed = new URL(trimmed)
    if (!SAFE_LINK_PROTOCOLS.has(parsed.protocol)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function getSafeHostname(value: string): string | null {
  const safeUrl = toSafeHttpUrl(value)
  if (!safeUrl) return null

  try {
    return new URL(safeUrl).hostname
  } catch {
    return null
  }
}
