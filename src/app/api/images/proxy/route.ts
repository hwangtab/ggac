import { NextRequest } from 'next/server'
import {
  createErrorResponse,
  createImageResponse,
  createOptionsResponse,
} from '@/utils/apiResponse'

export const dynamic = 'force-dynamic'

// Simple host allowlist (expand as needed)
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export async function GET(req: NextRequest) {
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

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
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

    if (!res.ok) {
      return createErrorResponse(`Upstream error: ${res.status}`, 400)
    }

    // Derive content type
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buff = Buffer.from(await res.arrayBuffer())

    // Cache for 1 day at the CDN/browser level
    return createImageResponse(buff, contentType, {
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    })
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'Timeout fetching image' : 'Failed to fetch image'
    return createErrorResponse(msg, 400)
  }
}

export function OPTIONS() {
  return createOptionsResponse('*')
}
