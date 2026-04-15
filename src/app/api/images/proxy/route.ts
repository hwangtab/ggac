import { NextRequest } from 'next/server'
import {
  createErrorResponse,
  createImageResponse,
  createOptionsResponse,
} from '@/utils/apiResponse'
import { isUnsafeHost } from '@/utils/ssrfProtection'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/utils/rateLimiter'

export const dynamic = 'force-dynamic'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const imageProxyRateLimit = applyRateLimit(RATE_LIMIT_CONFIGS.GENERAL_API)

export async function GET(req: NextRequest) {
  const rateLimitResult = imageProxyRateLimit(req)
  if (!rateLimitResult.success) {
    return createErrorResponse('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  const urlParam = req.nextUrl.searchParams.get('url')
  if (!urlParam) return createErrorResponse('Missing url parameter', 400)

  let target: URL
  try {
    const decoded = decodeURIComponent(urlParam)
    target = new URL(decoded)
  } catch {
    return createErrorResponse('Invalid url parameter', 400)
  }

  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    return createErrorResponse('Unsupported protocol', 400)
  }

  // SSRF protection: block private/internal IPs
  if (await isUnsafeHost(target.hostname)) {
    return createErrorResponse('Forbidden', 403)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      // Spoof a common UA to improve success rate on strict sites
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      // Prevent Next from caching upstream 4xx/5xx aggressively
      cache: 'no-store',
    })

    clearTimeout(timeout)

    // Handle redirects manually to prevent SSRF bypass
    if (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
      const location = res.headers.get('location')
      if (!location) {
        return createErrorResponse('Redirect with no Location header', 400)
      }
      let redirectUrl: URL
      try {
        redirectUrl = new URL(location)
      } catch {
        return createErrorResponse('Invalid redirect URL', 400)
      }
      if (!ALLOWED_PROTOCOLS.has(redirectUrl.protocol)) {
        return createErrorResponse('Redirect to unsupported protocol', 400)
      }
      if (await isUnsafeHost(redirectUrl.hostname)) {
        return createErrorResponse('Redirect to forbidden host', 400)
      }
      return createErrorResponse('Redirect not followed', 400)
    }

    if (!res.ok) {
      return createErrorResponse(`Upstream error: ${res.status}`, 400)
    }

    // Derive content type
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buff = Buffer.from(await res.arrayBuffer())

    // Cache for 1 day at the CDN/browser level
    return createImageResponse(buff, contentType, {
      'Cache-Control': 'public, max-age=86400',
    })
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'Timeout fetching image' : 'Failed to fetch image'
    return createErrorResponse(msg, 400)
  }
}

export function OPTIONS() {
  return createOptionsResponse(process.env.NEXT_PUBLIC_SITE_URL || 'https://ggac.kr')
}
