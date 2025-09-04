import { NextRequest, NextResponse } from 'next/server'
import { fetchLinkPreview } from '@/utils/linkPreview'
import distLimiter from '@/utils/distributedRateLimiter'

export async function GET(request: NextRequest) {
  // 분산 레이트리밋 (Upstash 있으면 Redis, 없으면 메모리)
  const limiter = await distLimiter.applyRateLimit({
    ...distLimiter.CONFIGS.SEARCH_API,
    keyGenerator: distLimiter.createRouteKeyGenerator('link_preview'),
  })
  const limit = await limiter(request)
  if (!limit.success && limit.response) {
    return limit.response
  }
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  console.log('Link preview API called with URL:', url)

  if (!url) {
    console.log('No URL provided')
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 })
  }

  try {
    // 프로토콜 및 형식 1차 검증 (세부 SSRF 검사는 유틸 내부에서 수행)
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Only http/https are allowed' }, { status: 400 })
    }
    console.log('URL validation passed:', url)
  } catch (error) {
    console.log('Invalid URL format:', url, error)
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

  try {
    const preview = await fetchLinkPreview(url)

    if (!preview) {
      console.log('Failed to fetch preview for:', url)
      return NextResponse.json({ error: 'Failed to fetch link preview' }, { status: 404 })
    }

    console.log('Successfully fetched preview for:', url)
    const res = NextResponse.json(preview)
    return distLimiter.addRateLimitHeaders(
      res,
      distLimiter.CONFIGS.SEARCH_API.maxRequests,
      limit.remaining,
      limit.resetTime
    )
  } catch (error) {
    console.error('Link preview API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
