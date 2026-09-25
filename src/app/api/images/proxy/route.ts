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

  const controller = new AbortController()
  // 타이머는 헤더가 아니라 **본문을 다 읽을 때까지** 살아 있어야 한다. 예전에는
  // fetch가 돌아오자마자 껐는데, 그러면 헤더만 빨리 주고 본문을 한 바이트씩
  // 흘리는 상대에게 연결이 무기한 붙잡힌다. 해제는 아래 finally가 한 번만 한다.
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
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

    // Content-Length는 상대가 주는 **주장**이고, chunked 응답에는 아예 없다.
    // 그래서 위 검사만으로는 8MB가 지켜지지 않는다 — 통째로 받아 놓고 길이를
    // 재던 예전 코드는 상대가 흘리는 만큼 메모리에 쌓은 뒤에야 거절했다.
    // 읽으면서 누적 바이트를 세고, 상한을 넘는 순간 연결을 끊는다.
    const buff = await readCappedBody(res, MAX_IMAGE_BYTES)
    if (!buff) {
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
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 응답 본문을 읽으면서 상한을 넘는 순간 스트림을 끊는다. 상한을 넘었으면
 * `null`을 돌려주고(부분 버퍼는 버린다), 정상이면 전체 버퍼를 돌려준다.
 *
 * 상한 판정을 **읽은 뒤**가 아니라 **읽는 중**에 하는 것이 요점이다. 8MB
 * 상한을 두고도 통째로 버퍼링하면, 상한은 응답 코드만 바꿀 뿐 메모리는 이미
 * 다 썼다.
 */
async function readCappedBody(res: Response, maxBytes: number): Promise<Buffer | null> {
  if (!res.body) {
    const buff = Buffer.from(await res.arrayBuffer())
    return buff.length > maxBytes ? null : buff
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks)
}

export function OPTIONS() {
  return createOptionsResponse(process.env.NEXT_PUBLIC_SITE_URL || 'https://ggac.kr')
}
