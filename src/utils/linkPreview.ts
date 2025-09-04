import { load } from 'cheerio'
import dns from 'dns/promises'
import { getCachedPreviewFromDB, setCachedPreviewToDB } from '@/utils/linkPreviewCache'
import type { LinkPreview, TicketingInfo } from '@/types'

// 기존에 별도로 정의되어 있던 TicketingInfo를 export로 유지 (하위 호환성)
export type { LinkPreview, TicketingInfo } from '@/types'

// 간단한 런타임 캐시 (서버 인스턴스 생명주기 내)
interface CacheEntry<T> {
  data: T
  ts: number
}
const previewCache = new Map<string, CacheEntry<LinkPreview>>()
const PREVIEW_TTL_MS = 60 * 60 * 1000 // 1시간

function getCache(url: string): LinkPreview | null {
  const key = url.trim()
  const entry = previewCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > PREVIEW_TTL_MS) {
    previewCache.delete(key)
    return null
  }
  return entry.data
}

function setCache(url: string, data: LinkPreview) {
  const key = url.trim()
  previewCache.set(key, { data, ts: Date.now() })
  // 메모리 사용 제한: 500개 초과 시 오래된 항목 제거
  if (previewCache.size > 500) {
    let oldestKey: string | null = null
    let oldestTs = Infinity
    for (const [k, v] of previewCache.entries()) {
      if (v.ts < oldestTs) {
        oldestTs = v.ts
        oldestKey = k
      }
    }
    if (oldestKey) previewCache.delete(oldestKey)
  }
}

// ---- SSRF/프리플라이트 보호 설정 ----
const MAX_HTML_BYTES = 2_000_000 // 2MB 상한
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

function isPrivateIPv4(ip: string): boolean {
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16
  const parts = ip.split('.').map(n => parseInt(n, 10))
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  // Loopback ::1, link-local fe80::/10, unique local fc00::/7
  const lower = ip.toLowerCase()
  return (
    lower === '::1' ||
    lower.startsWith('fe8') || // fe80::/10 covers fe80-fe8f
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd')
  )
}

async function isUnsafeHost(hostname: string): Promise<boolean> {
  try {
    // 명시적 차단: localhost/ipv6 localhost/0.0.0.0
    const blockedHostnames = new Set(['localhost', '0.0.0.0'])
    if (blockedHostnames.has(hostname.toLowerCase())) return true

    const records = await dns.lookup(hostname, { all: true })
    if (!records || records.length === 0) return true
    for (const rec of records) {
      const ip = rec.address
      if (ip.includes(':')) {
        if (isPrivateIPv6(ip)) return true
      } else {
        if (isPrivateIPv4(ip)) return true
      }
    }
    return false
  } catch {
    // DNS 해석 실패 시 보수적으로 차단
    return true
  }
}

async function preflightRequest(
  url: string
): Promise<{ ok: boolean; reason?: string; contentType?: string; contentLength?: number }> {
  try {
    const u = new URL(url)
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
      return { ok: false, reason: 'Protocol not allowed' }
    }
    if (await isUnsafeHost(u.hostname)) {
      return { ok: false, reason: 'Host resolves to private or unsafe IP' }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    let headRes: Response | null = null
    try {
      headRes = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'GGAC-LinkPreview/1.0',
          Accept: 'text/html,application/xhtml+xml',
        },
        cache: 'no-store',
      })
    } catch {
      // 일부 서버는 HEAD 미지원 → 본 요청에서 검사
    } finally {
      clearTimeout(timeout)
    }

    let contentType = headRes?.headers.get('content-type') || undefined
    let contentLength = headRes?.headers.get('content-length')
      ? parseInt(headRes!.headers.get('content-length') as string, 10)
      : undefined

    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ok: false, reason: 'Unsupported content-type', contentType, contentLength }
    }
    if (contentLength && contentLength > MAX_HTML_BYTES) {
      return { ok: false, reason: 'Content too large', contentType, contentLength }
    }

    return { ok: true, contentType, contentLength }
  } catch (e) {
    return { ok: false, reason: 'Preflight failed' }
  }
}

// 재시도 로직을 가진 fetch 함수
async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response | null> {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ]

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 [LinkPreview] Attempt ${attempt}/${maxRetries} for: ${url}`)

      const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)]
      console.log(`👤 [LinkPreview] Using User-Agent: ${randomUserAgent.substring(0, 50)}...`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10초 타임아웃

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': randomUserAgent,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          DNT: '1',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        next: {
          revalidate: process.env.NODE_ENV === 'development' ? 60 : 3600,
        },
      })

      clearTimeout(timeoutId)

      console.log(
        `📡 [LinkPreview] Response: ${response.status} ${response.statusText} (attempt ${attempt})`
      )

      if (response.ok) {
        return response
      } else if (response.status === 429) {
        // Rate limiting - 긴 대기
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
        console.warn(`⏱️ [LinkPreview] Rate limited, waiting ${delay}ms before retry`)
        await new Promise(resolve => setTimeout(resolve, delay))
      } else if (response.status >= 500) {
        // 서버 오류 - 재시도
        const delay = 1000 * attempt
        console.warn(
          `🔄 [LinkPreview] Server error ${response.status}, waiting ${delay}ms before retry`
        )
        await new Promise(resolve => setTimeout(resolve, delay))
      } else {
        // 클라이언트 오류 (4xx) - 재시도하지 않음
        console.error(`❌ [LinkPreview] Client error ${response.status} for ${url}, not retrying`)
        return null
      }
    } catch (error) {
      console.error(`💥 [LinkPreview] Attempt ${attempt} failed:`, error)

      if (attempt === maxRetries) {
        return null
      }

      // 네트워크 오류 시 점진적 대기
      const delay = 1000 * attempt
      console.log(`⏳ [LinkPreview] Waiting ${delay}ms before retry...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  return null
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    console.log(`🔍 [LinkPreview] Starting fetch for: ${url}`)
    // 캐시 조회 (DB → 메모리 순서)
    const dbCached = await getCachedPreviewFromDB(url)
    if (dbCached) {
      setCache(url, dbCached)
      return dbCached
    }
    const cached = getCache(url)
    if (cached) return cached
    // Preflight 검증 (프로토콜/호스트/DNS/IP/헤더)
    const preflight = await preflightRequest(url)
    if (!preflight.ok) {
      console.warn(`❌ [LinkPreview] Preflight rejected: ${preflight.reason}`)
      return null
    }

    const response = await fetchWithRetry(url, 3)

    if (!response) {
      console.error(`❌ [LinkPreview] All retry attempts failed for: ${url}`)
      return null
    }
    // 본 응답의 Content-Type/Length 확인
    const respType = response.headers.get('content-type') || ''
    if (!/text\/html|application\/xhtml\+xml/i.test(respType)) {
      console.warn(`❌ [LinkPreview] Unsupported content-type: ${respType}`)
      return null
    }
    const len = response.headers.get('content-length')
    if (len && parseInt(len, 10) > MAX_HTML_BYTES) {
      console.warn(`❌ [LinkPreview] Content too large: ${len}`)
      return null
    }

    const html = await response.text()
    if (html.length > MAX_HTML_BYTES) {
      console.warn(`❌ [LinkPreview] HTML body exceeded size limit: ${html.length}`)
      return null
    }
    const $ = load(html)

    // 메타데이터 추출
    const getMetaContent = (property: string, name?: string): string => {
      // Open Graph 태그 우선
      let content = $(`meta[property="${property}"]`).attr('content')

      // name 속성으로 찾기
      if (!content && name) {
        content = $(`meta[name="${name}"]`).attr('content')
      }

      return content?.trim() || ''
    }

    // 이미지 URL 정규화
    const normalizeImageUrl = (imageUrl: string): string => {
      if (!imageUrl) return ''

      // 절대 URL인 경우 그대로 반환
      if (imageUrl.startsWith('http')) {
        return imageUrl
      }

      // 상대 URL인 경우 절대 URL로 변환
      try {
        const baseUrl = new URL(url)
        if (imageUrl.startsWith('//')) {
          return `${baseUrl.protocol}${imageUrl}`
        } else if (imageUrl.startsWith('/')) {
          return `${baseUrl.protocol}//${baseUrl.host}${imageUrl}`
        } else {
          return `${baseUrl.protocol}//${baseUrl.host}/${imageUrl}`
        }
      } catch {
        return imageUrl
      }
    }

    // 파비콘 찾기
    const getFaviconUrl = (): string => {
      let favicon =
        $('link[rel="icon"]').attr('href') ||
        $('link[rel="shortcut icon"]').attr('href') ||
        $('link[rel="apple-touch-icon"]').attr('href')

      if (!favicon) {
        // 기본 파비콘 경로 시도
        try {
          const baseUrl = new URL(url)
          favicon = `${baseUrl.protocol}//${baseUrl.host}/favicon.ico`
        } catch {
          favicon = ''
        }
      }

      return normalizeImageUrl(favicon)
    }

    const title =
      getMetaContent('og:title') || $('title').text() || getMetaContent('twitter:title', 'title')

    const description =
      getMetaContent('og:description') || getMetaContent('twitter:description', 'description')

    const image = normalizeImageUrl(getMetaContent('og:image') || getMetaContent('twitter:image'))

    const siteName =
      getMetaContent('og:site_name') || $('title').text().split(' - ')[0] || new URL(url).hostname

    const favicon = getFaviconUrl()

    // HTML 엔티티 디코딩 및 XSS 방지를 위한 데이터 정제
    const sanitizeText = (text: string): string => {
      if (typeof text !== 'string') return ''

      // 1단계: HTML 엔티티 디코딩
      const decoded = text
        .replace(/&#x27;/g, "'") // 작은따옴표
        .replace(/&#39;/g, "'") // 작은따옴표 (다른 인코딩)
        .replace(/&quot;/g, '"') // 큰따옴표
        .replace(/&lt;/g, '<') // 작은 부등호
        .replace(/&gt;/g, '>') // 큰 부등호
        .replace(/&amp;/g, '&') // 앰퍼샌드 (마지막에 처리)

      // 2단계: 안전하지 않은 HTML 태그만 이스케이프 (XSS 방지)
      return decoded
        .replace(/[<>]/g, char => {
          const map: { [key: string]: string } = {
            '<': '&lt;',
            '>': '&gt;',
          }
          return map[char] || char
        })
        .replace(/\s+/g, ' ')
        .trim()
    }

    const preview: LinkPreview = {
      title: sanitizeText(title).slice(0, 100), // 제목 길이 제한 및 XSS 방지
      description: sanitizeText(description).slice(0, 200), // 설명 길이 제한 및 XSS 방지
      image,
      siteName: sanitizeText(siteName).slice(0, 50), // 사이트명 XSS 방지
      url,
      favicon,
    }

    // 상세 로깅
    console.log(`✅ [LinkPreview] Successfully extracted preview for ${url}:`)
    console.log(`📄 Title: "${preview.title}"`)
    console.log(
      `📝 Description: "${preview.description.substring(0, 100)}${preview.description.length > 100 ? '...' : ''}"`
    )
    console.log(`🖼️ Image: ${preview.image || 'none'}`)
    console.log(`🏷️ Site Name: "${preview.siteName}"`)
    console.log(`🔗 Favicon: ${preview.favicon || 'none'}`)

    // 이미지가 없는 경우 경고
    if (!preview.image) {
      console.warn(`⚠️ [LinkPreview] No image found for ${url}`)
      console.log(`🔍 [LinkPreview] Available meta tags:`)
      $('meta[property^="og:"], meta[name^="twitter:"], meta[property^="twitter:"]').each(
        (_, el) => {
          const $el = $(el)
          const property = $el.attr('property') || $el.attr('name')
          const content = $el.attr('content')
          console.log(`    ${property}: ${content}`)
        }
      )
    }

    // 캐시 저장 (메모리 + DB)
    setCache(url, preview)
    setCachedPreviewToDB(url, preview).catch(() => {})
    return preview
  } catch (error) {
    console.error(`Error fetching link preview for ${url}:`, error)
    return null
  }
}

// 여러 URL의 프리뷰를 동시에 가져오기
export async function fetchMultipleLinkPreviews(urls: string[]): Promise<(LinkPreview | null)[]> {
  const promises = urls.map(url => fetchLinkPreview(url))
  return Promise.all(promises)
}
