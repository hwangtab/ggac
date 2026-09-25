import { NextRequest } from 'next/server'
import { createImageResponse, createOptionsResponse } from '@/utils/apiResponse'
import { ApiError } from '@/utils/apiWrapper'
import {
  fetchPinned,
  isUnsafeHost,
  ResponseTooLargeError,
  SsrfBlockedError,
} from '@/utils/ssrfProtection'
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
    // 위 `isUnsafeHost`는 **이름**을 봤을 뿐이다. 그 뒤에 평범한 fetch를 하면
    // 이름을 한 번 더 풀게 되고, 그 사이에 공격자가 자기 DNS 레코드를 내부
    // 주소로 바꿔 두면 검사는 통과하고 접속만 내부로 간다. `fetchPinned`는
    // 이름을 한 번 풀어 검사한 그 IP로만 접속한다.
    const res = await fetchPinned(target.toString(), {
      method: 'GET',
      redirect: 'manual',
      timeoutMs: 8000,
      maxBytes: MAX_IMAGE_BYTES,
      // Spoof a common UA to improve success rate on strict sites
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      // 이미지가 아니거나 리다이렉트면 본문을 아예 받지 않는다.
      acceptResponse: (status, headers) =>
        status >= 200 &&
        status < 300 &&
        ALLOWED_IMAGE_TYPES.has(
          (headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
        ),
    })

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

    // Content-Length는 상대가 주는 **주장**이고 chunked 응답에는 아예 없다.
    // 실제 상한은 `fetchPinned`가 본문을 읽으면서 건다(넘으면
    // ResponseTooLargeError). 위 헤더 검사는 받기 전에 거절할 수 있는 건은
    // 미리 거절하는 지름길일 뿐이다.
    const buff = Buffer.from(await res.arrayBuffer())

    // Cache for 1 day at the CDN/browser level
    return createImageResponse(buff, contentType, {
      'Cache-Control': 'public, max-age=86400',
    })
  } catch (err: unknown) {
    if (err instanceof SsrfBlockedError) {
      return ApiError.forbidden('Forbidden').toNextResponse()
    }
    if (err instanceof ResponseTooLargeError) {
      return ApiError.badRequest('Upstream image is too large').toNextResponse()
    }
    const isTimeout = err instanceof Error && /timed out|aborted/i.test(err.message)
    const msg = isTimeout ? 'Timeout fetching image' : 'Failed to fetch image'
    return ApiError.badRequest(msg).toNextResponse()
  }
}

export function OPTIONS() {
  return createOptionsResponse(process.env.NEXT_PUBLIC_SITE_URL || 'https://ggac.kr')
}
