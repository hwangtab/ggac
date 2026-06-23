import { NextRequest } from 'next/server'
import { createImageResponse, createOptionsResponse } from '@/utils/apiResponse'
import { ApiError } from '@/utils/apiWrapper'
import { isUnsafeHost } from '@/utils/ssrfProtection'
import distLimiter from '@/lib/server/rateLimit'
import { parseIntegerParam } from '@/utils/queryParams'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
])
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export async function GET(req: NextRequest) {
  const rateLimiter = await distLimiter.applyRateLimit({
    ...distLimiter.CONFIGS.GENERAL_API,
    keyGenerator: distLimiter.createIPKeyGenerator('img_proxy'),
  })
  const rateLimitResult = await rateLimiter(req)
  if (!rateLimitResult.success && rateLimitResult.response) {
    return rateLimitResult.response
  }

  const urlParam = req.nextUrl.searchParams.get('url')
  if (!urlParam) return ApiError.badRequest('Missing url parameter').toNextResponse()

  let target: URL
  try {
    const decoded = decodeURIComponent(urlParam)
    target = new URL(decoded)
  } catch {
    return ApiError.badRequest('Invalid url parameter').toNextResponse()
  }

  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    return ApiError.badRequest('Unsupported protocol').toNextResponse()
  }

  if (await isUnsafeHost(target.hostname)) {
    return ApiError.forbidden('Forbidden').toNextResponse()
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
        return ApiError.badRequest('Redirect with no Location header').toNextResponse()
      }
      let redirectUrl: URL
      try {
        redirectUrl = new URL(location, target)
      } catch {
        return ApiError.badRequest('Invalid redirect URL').toNextResponse()
      }
      if (!ALLOWED_PROTOCOLS.has(redirectUrl.protocol)) {
        return ApiError.badRequest('Redirect to unsupported protocol').toNextResponse()
      }
      if (await isUnsafeHost(redirectUrl.hostname)) {
        return ApiError.badRequest('Redirect to forbidden host').toNextResponse()
      }
      return ApiError.badRequest('Redirect not followed').toNextResponse()
    }

    if (!res.ok) {
      return ApiError.badRequest(`Upstream error: ${res.status}`).toNextResponse()
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return ApiError.badRequest('Upstream response is not a supported image').toNextResponse()
    }

    const contentLength = parseIntegerParam(res.headers.get('content-length'), 0, { min: 0 })
    if (contentLength > MAX_IMAGE_BYTES) {
      return ApiError.badRequest('Upstream image is too large').toNextResponse()
    }

    const buff = Buffer.from(await res.arrayBuffer())
    if (buff.length > MAX_IMAGE_BYTES) {
      return ApiError.badRequest('Upstream image is too large').toNextResponse()
    }

    // Cache for 1 day at the CDN/browser level
    return createImageResponse(buff, contentType, {
      'Cache-Control': 'public, max-age=86400',
    })
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    const msg = isAbort ? 'Timeout fetching image' : 'Failed to fetch image'
    return ApiError.badRequest(msg).toNextResponse()
  }
}

export function OPTIONS() {
  return createOptionsResponse(process.env.NEXT_PUBLIC_SITE_URL || 'https://ggac.kr')
}
