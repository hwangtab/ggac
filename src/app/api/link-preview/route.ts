import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { fetchLinkPreview } from '@/utils/linkPreview'
import distLimiter from '@/lib/server/rateLimit'
import { createSupabaseServer } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  // 인증 확인 — 로그인한 사용자만 링크 프리뷰 요청 가능
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return createErrorResponse({ success: false, error: '로그인이 필요합니다.' }, 401)
  }

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

  if (!url) {
    return createErrorResponse({ success: false, error: 'URL parameter is required' }, 400)
  }

  try {
    // 프로토콜 및 형식 1차 검증 (세부 SSRF 검사는 유틸 내부에서 수행)
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return createErrorResponse({ success: false, error: 'Only http/https are allowed' }, 400)
    }
  } catch {
    return createErrorResponse({ success: false, error: 'Invalid URL format' }, 400)
  }

  try {
    const preview = await fetchLinkPreview(url)

    if (!preview) {
      return createErrorResponse({ success: false, error: 'Failed to fetch link preview' }, 404)
    }

    const res = NextResponse.json(preview)
    return distLimiter.addRateLimitHeaders(
      res,
      distLimiter.CONFIGS.SEARCH_API.maxRequests,
      limit.remaining,
      limit.resetTime
    )
  } catch (error) {
    console.error('Link preview API error:', error)
    return createErrorResponse({ success: false, error: 'Internal server error' }, 500)
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
